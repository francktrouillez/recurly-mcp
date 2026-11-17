import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RecurlyClient } from './client/recurly.js';
import { loadConfig } from './config.js';
import { shapeResult } from './responseGuard.js';
import { allTools } from './tools/index.js';
import type { ToolContext } from './tools/types.js';

// Read version from package.json at runtime so it can never drift from the
// published version. Resolution: `../package.json` from src/server.ts (dev via
// tsx) and from dist/server.js (published) both land on the package root's
// package.json, which npm always ships.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

// MCP clients (notably Claude) reject tool inputSchemas that use top-level
// `anyOf` / `oneOf` / `allOf`. Zod 4 compiles `discriminatedUnion` to
// `{oneOf: [...]}`, so we flatten the branches into a single object schema:
// all properties unioned, the `action` discriminator becomes an enum, and
// `required` is the intersection across branches (since branch-specific
// requireds aren't enforceable at the top level). Runtime validation still
// happens inside each tool handler via `inputSchema.parse(input)`.

type JsonObject = Record<string, unknown>;

function mergeUnionBranches(branches: unknown[]): JsonObject {
  const properties: JsonObject = {};
  const actionValues: unknown[] = [];
  const requiredCounts: Record<string, number> = {};
  let total = 0;
  for (const branch of branches) {
    if (!branch || typeof branch !== 'object') continue;
    const b = branch as JsonObject;
    if (b.type !== 'object') continue;
    total++;
    const branchProps = (b.properties as JsonObject | undefined) ?? {};
    for (const [name, propSchema] of Object.entries(branchProps)) {
      if (name === 'action') {
        const value = (propSchema as JsonObject).const;
        if (value !== undefined && !actionValues.includes(value)) actionValues.push(value);
      }
      if (!(name in properties)) properties[name] = propSchema;
    }
    for (const name of (b.required as string[] | undefined) ?? []) {
      requiredCounts[name] = (requiredCounts[name] ?? 0) + 1;
    }
  }
  if (properties.action) {
    const { const: _const, ...rest } = properties.action as JsonObject;
    properties.action = { ...rest, enum: actionValues };
  }
  const required = Object.entries(requiredCounts)
    .filter(([, count]) => count === total)
    .map(([name]) => name);
  const result: JsonObject = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) result.required = required;
  return result;
}

export function toMcpInputSchema(schema: z.ZodType): JsonObject {
  // `io: 'output'` closes every plain object (`additionalProperties: false`),
  // matching how the parser drops unknown keys. Caveat: output mode marks
  // `.default()` fields as required, so revisit this if a tool input gains one.
  // `reused: 'inline'` avoids $defs/$ref so every schema is self-contained.
  const { $schema: _schemaUri, ...json } = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'output',
    reused: 'inline',
  }) as JsonObject;
  if (Array.isArray(json.oneOf)) return mergeUnionBranches(json.oneOf);
  return { type: 'object', ...json };
}

export async function createServer(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<Server> {
  const config = loadConfig(env);
  if (!config.apiKey) {
    // Silently accepting an empty key means every request 401s with no startup
    // signal — surface it once so misconfigured deployments notice immediately.
    process.stderr.write(
      'recurly-mcp: warning: RECURLY_API_KEY is not set — all API calls will fail with 401\n',
    );
  }
  const client = new RecurlyClient(config);
  const ctx: ToolContext = { client, config };

  const server = new Server(
    { name: 'recurly-mcp', version: PKG_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toMcpInputSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = allTools.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const result = await tool.handler(ctx, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: shapeResult(result, config.maxOutputBytes) }] };
    } catch (err) {
      // Cap the error text too: the success path goes through shapeResult, but
      // an error message can also carry upstream content, so bound it the same way.
      const message = err instanceof Error ? err.message : String(err);
      const text =
        message.length > config.maxOutputBytes
          ? `${message.slice(0, config.maxOutputBytes)}…[truncated]`
          : message;
      return { isError: true, content: [{ type: 'text', text }] };
    }
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
