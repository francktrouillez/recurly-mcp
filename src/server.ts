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
// happens inside each tool handler via `inputSchema.parse(input)`; branches are
// strict, so a property that only another action accepts is rejected by name.
// To keep the model from sending those, a property not shared by every action
// gets the actions that accept it appended to its description.

type JsonObject = Record<string, unknown>;

// Description of a property merged from several branches, given each distinct
// branch description and the actions using it. One description shared by every
// action is kept as-is; otherwise each is tagged with its actions, so e.g. a
// `state` filter reads "list: Filter by subscription state. list_invoices:
// Filter by invoice state." instead of claiming the first branch's meaning.
function mergedDescription(
  byDescription: Map<string, unknown[]>,
  actionCount: number,
): string | undefined {
  const groups = [...byDescription];
  if (groups.length === 1) {
    const [description, actions] = groups[0]!;
    if (actions.length === actionCount) return description || undefined;
    const note = `Only for action${actions.length > 1 ? 's' : ''}: ${actions.join(', ')}.`;
    return description ? `${description} ${note}` : note;
  }
  return groups
    .map(([description, actions]) => `${actions.join(', ')}: ${description || '(no description)'}`)
    .join(' ');
}

function mergeUnionBranches(branches: unknown[]): JsonObject {
  const properties: JsonObject = {};
  const actionValues: unknown[] = [];
  const requiredCounts: Record<string, number> = {};
  const descriptions: Record<string, Map<string, unknown[]>> = {};
  let total = 0;
  for (const branch of branches) {
    if (!branch || typeof branch !== 'object') continue;
    const b = branch as JsonObject;
    if (b.type !== 'object') continue;
    total++;
    const branchProps = (b.properties as JsonObject | undefined) ?? {};
    const action = (branchProps.action as JsonObject | undefined)?.const;
    if (action !== undefined && !actionValues.includes(action)) actionValues.push(action);
    for (const [name, propSchema] of Object.entries(branchProps)) {
      if (!(name in properties)) properties[name] = propSchema;
      if (action === undefined || name === 'action') continue;
      const description = (propSchema as JsonObject).description;
      const byDescription = (descriptions[name] ??= new Map());
      const key = typeof description === 'string' ? description : '';
      byDescription.set(key, [...(byDescription.get(key) ?? []), action]);
    }
    for (const name of (b.required as string[] | undefined) ?? []) {
      requiredCounts[name] = (requiredCounts[name] ?? 0) + 1;
    }
  }
  if (properties.action) {
    const { const: _const, ...rest } = properties.action as JsonObject;
    properties.action = { ...rest, enum: actionValues };
  }
  for (const [name, byDescription] of Object.entries(descriptions)) {
    const { description: _first, ...prop } = properties[name] as JsonObject;
    const description = mergedDescription(byDescription, actionValues.length);
    properties[name] = description === undefined ? prop : { ...prop, description };
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
  // matching the parser, which rejects (strict branches) or strips unknown keys.
  // Caveat: output mode marks `.default()` fields as required, so revisit this
  // if a tool input gains one.
  // `reused: 'inline'` avoids $defs/$ref so every schema is self-contained.
  const { $schema: _schemaUri, ...json } = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'output',
    reused: 'inline',
  }) as JsonObject;
  if (Array.isArray(json.oneOf)) return mergeUnionBranches(json.oneOf);
  return { type: 'object', ...json };
}

// A ZodError's own message is a JSON dump of its issues; prettify it so the
// client reads e.g. `✖ Unrecognized key: "begin_time"` for an unsupported param.
function errorMessage(err: unknown, toolName: string): string {
  if (err instanceof z.ZodError)
    return `Invalid arguments for ${toolName}:\n${z.prettifyError(err)}`;
  if (err instanceof Error) return err.message;
  return String(err);
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
      const message = errorMessage(err, tool.name);
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
