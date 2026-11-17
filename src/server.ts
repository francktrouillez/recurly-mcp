import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RecurlyClient, type HttpMethod } from './client/recurly.js';
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
// gets the actions that accept it appended to its description. A property name
// several actions declare differently (e.g. a subscription vs an invoice
// `state`) advertises the union of their enum values and tags each meaning with
// its actions; each branch's zod schema still validates its own exact values.

type JsonObject = Record<string, unknown>;

// One way a property is declared across branches, and the actions declaring it:
// its description and enum values, plus the rest of its schema (`base`), which
// every variant of a property must share.
interface Variant {
  base: JsonObject;
  description: string;
  values: unknown[] | undefined;
  actions: unknown[];
}

// Key-order-insensitive JSON, so equal schemas and enums compare equal.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

const enumKey = (values: unknown[] | undefined): string =>
  canonical(values ? [...values].sort() : null);

function toVariant(schema: JsonObject, action: unknown): Variant {
  const { description, enum: values, ...base } = schema;
  return {
    base,
    description: typeof description === 'string' ? description : '',
    values: Array.isArray(values) ? values : undefined,
    actions: [action],
  };
}

// Union of every variant's enum values, so no action's values are hidden. If
// any variant is unconstrained, so is the merged property.
function mergedEnum(variants: Variant[]): unknown[] | undefined {
  if (variants.some((v) => v.values === undefined)) return undefined;
  return [...new Set(variants.flatMap((v) => v.values!))];
}

// One variant shared by every action keeps its description; one used by only
// some actions notes them; several are each tagged with their actions (and
// their values, when those differ), e.g. "list: Filter by subscription state.
// One of: active, … list_invoices: Filter by invoice state. One of: paid, …".
function mergedDescription(variants: Variant[], actionCount: number): string | undefined {
  if (variants.length === 1) {
    const { description, actions } = variants[0]!;
    if (actions.length === actionCount) return description || undefined;
    const note = `Only for action${actions.length > 1 ? 's' : ''}: ${actions.join(', ')}.`;
    return description ? `${description} ${note}` : note;
  }
  const enumsDiffer = new Set(variants.map((v) => enumKey(v.values))).size > 1;
  return variants
    .map(({ description, values, actions }) => {
      const valueNote = enumsDiffer && values ? ` One of: ${values.join(', ')}.` : '';
      return `${actions.join(', ')}: ${description || '(no description)'}${valueNote}`;
    })
    .join(' ');
}

// Only descriptions and enum values may differ between actions: anything else
// (type, bounds, …) can't be advertised faithfully in one flat schema, so it
// fails loudly at startup instead of silently showing the first action's.
function mergeProperty(name: string, variants: Variant[], actionCount: number): JsonObject {
  const base = variants[0]!.base;
  if (variants.some((v) => canonical(v.base) !== canonical(base))) {
    throw new Error(`property "${name}" has incompatible schemas across actions`);
  }
  const values = mergedEnum(variants);
  const description = mergedDescription(variants, actionCount);
  return {
    ...base,
    ...(values !== undefined && { enum: values }),
    ...(description !== undefined && { description }),
  };
}

function mergeUnionBranches(branches: unknown[]): JsonObject {
  const properties: JsonObject = {};
  const actionValues: unknown[] = [];
  const requiredCounts: Record<string, number> = {};
  const variants: Record<string, Map<string, Variant>> = {};
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
      if (action === undefined || name === 'action') {
        if (!(name in properties)) properties[name] = propSchema;
        continue;
      }
      const variant = toVariant(propSchema as JsonObject, action);
      const key = canonical([variant.description, enumKey(variant.values), variant.base]);
      const byKey = (variants[name] ??= new Map());
      const seen = byKey.get(key);
      byKey.set(key, seen ? { ...seen, actions: [...seen.actions, action] } : variant);
    }
    for (const name of (b.required as string[] | undefined) ?? []) {
      requiredCounts[name] = (requiredCounts[name] ?? 0) + 1;
    }
  }
  if (properties.action) {
    const { const: _const, ...rest } = properties.action as JsonObject;
    properties.action = { ...rest, enum: actionValues };
  }
  for (const [name, byKey] of Object.entries(variants)) {
    properties[name] = mergeProperty(name, [...byKey.values()], actionValues.length);
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

// Every tool only ever issues GET, so the behavioural hints are identical for
// all of them and set here rather than per tool. `openWorldHint` is true because
// tools reach an external system (the Recurly API). The conditional type makes
// this fail to compile if the client's `HttpMethod` ever widens beyond GET.
const READ_ONLY_HINTS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const satisfies ToolAnnotations & (HttpMethod extends 'GET' ? unknown : never);

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

  // Tool schemas are static, so convert them once rather than per tools/list.
  const tools = allTools.map((t) => {
    try {
      return {
        name: t.name,
        // Top-level `title` is the current spec field; `annotations.title` is
        // the older location some clients still read. Emit both.
        title: t.title,
        description: t.description,
        inputSchema: toMcpInputSchema(t.inputSchema),
        annotations: { title: t.title, ...READ_ONLY_HINTS },
      };
    } catch (err) {
      throw new Error(`${t.name}: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

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
