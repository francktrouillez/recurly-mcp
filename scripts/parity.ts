// Logic behind `npm run parity`: compare the GET surface of Recurly's
// published OpenAPI spec with the endpoints and query params our tools use.
// No network I/O here so the unit tests can drive it with an inline fixture
// spec; the only side effect is a throwaway temp dir while deriving actions.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { RecurlyClient, RequestOptions } from '../src/client/recurly.js';
import { loadConfig, type Config } from '../src/config.js';
import { allTools } from '../src/tools/index.js';
import { requestTool } from '../src/tools/request.js';
import type { ToolContext, ToolDefinition } from '../src/tools/types.js';

// The resource tools whose surface should mirror the spec. `recurly_request`
// is the raw-GET escape hatch and maps to no single endpoint.
export const parityTools = allTools.filter((t) => t !== requestTool);

// Recurly's cursor travels inside the `next` link rather than as a documented
// query param, so we accept it on every list action without flagging it.
const ALWAYS_ALLOWED_PARAMS: ReadonlySet<string> = new Set(['cursor']);

// Params that only control how this server returns the result, so they are
// never sent to Recurly. Keyed by `tool.action`.
const LOCAL_PARAMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['recurly_invoices.get_pdf', ['delivery']],
]);

export interface SpecEndpoint {
  path: string;
  operationId: string | undefined;
  deprecated: boolean;
  query: string[];
}

export interface ToolAction {
  tool: string;
  action: string;
  path: string;
  params: string[];
}

export interface ParityReport {
  specEndpointCount: number;
  // Errors: spec surface we don't expose.
  missingEndpoints: SpecEndpoint[];
  missingParams: { path: string; actions: string[]; params: string[] }[];
  deriveErrors: string[];
  // Warnings (errors under --strict): our surface the spec doesn't document.
  deprecatedMissingEndpoints: SpecEndpoint[];
  extraParams: { path: string; action: string; params: string[] }[];
  unknownEndpoints: ToolAction[];
}

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// Path templates match regardless of placeholder names: the spec and our code
// may call the same segment `{account_id}` and `{id}`.
const templateKey = (path: string): string => path.replace(/\{[^}]+\}/g, '{}');

const label = (tool: string, action: string): string => `${tool}.${action}`;
const actionLabel = (a: ToolAction): string => label(a.tool, a.action);

const MAX_REF_DEPTH = 16;

// Follow (possibly chained) local `$ref`s to the referenced node.
function resolveRef(spec: JsonObject, value: unknown): unknown {
  let current = value;
  for (let depth = 0; isObject(current) && typeof current.$ref === 'string'; depth++) {
    const ref = current.$ref;
    if (depth === MAX_REF_DEPTH) throw new Error(`$ref chain too deep (cycle?): ${ref}`);
    if (!ref.startsWith('#/')) throw new Error(`unsupported external $ref: ${ref}`);
    let node: unknown = spec;
    for (const raw of ref.slice(2).split('/')) {
      const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isObject(node) || !(segment in node)) throw new Error(`unresolvable $ref: ${ref}`);
      node = node[segment];
    }
    current = node;
  }
  return current;
}

// Every GET operation in the spec with its query params, resolving `$ref`
// parameters and merging path-level with operation-level declarations.
export function extractSpecEndpoints(spec: unknown): SpecEndpoint[] {
  if (!isObject(spec) || !isObject(spec.paths)) {
    throw new Error('not an OpenAPI document: missing top-level `paths` object');
  }
  const endpoints: SpecEndpoint[] = [];
  for (const [path, rawItem] of Object.entries(spec.paths)) {
    const item = resolveRef(spec, rawItem);
    if (!isObject(item) || !isObject(item.get)) continue;
    const op = item.get;
    const declared = [item.parameters, op.parameters].flatMap((ps) =>
      Array.isArray(ps) ? ps : [],
    );
    const query = new Set<string>();
    for (const p of declared) {
      const param = resolveRef(spec, p);
      // Fail loudly: silently skipping a malformed param could hide drift.
      if (!isObject(param) || typeof param.name !== 'string') {
        throw new Error(`${path}: malformed parameter (no string \`name\`): ${JSON.stringify(p)}`);
      }
      if (param.in === 'query') query.add(param.name);
    }
    endpoints.push({
      path,
      operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
      deprecated: op.deprecated === true,
      query: [...query].sort(),
    });
  }
  return endpoints.sort((a, b) => a.path.localeCompare(b.path));
}

function schemaOptions(schema: z.ZodType): z.ZodObject[] {
  if (schema instanceof z.ZodDiscriminatedUnion) return schema.options as z.ZodObject[];
  if (schema instanceof z.ZodObject) return [schema];
  throw new Error('input schema is neither a z.object nor a discriminated union of objects');
}

const placeholder = (key: string): string => `P_${key}_P`;

// A value the key's schema accepts. Strings get a recognizable placeholder so
// it can be spotted (and mapped back to `{key}`) in the recorded path.
function sampleValue(key: string, schema: z.ZodType): unknown {
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  const enumValues = inner instanceof z.ZodEnum ? inner.options : [];
  const candidates = [placeholder(key), 1, true, [placeholder(key)], ...enumValues];
  const value = candidates.find((c) => schema.safeParse(c).success);
  if (value === undefined) throw new Error(`no sample value satisfies the schema for "${key}"`);
  return value;
}

// Derive what a tool action actually calls: fill every key with a valid sample
// value, run the real handler against a recording client, and read the path
// template and query params off the request it issues. A key that reaches
// neither the path nor the query is reported, since it would be silently ignored.
async function deriveAction(
  tool: ToolDefinition<z.ZodType>,
  option: z.ZodObject,
  config: Config,
): Promise<ToolAction> {
  const { action: discriminator, ...fields } = option.shape;
  const literal = discriminator instanceof z.ZodLiteral ? discriminator.value : undefined;
  const action = literal === undefined ? '(single)' : String(literal);
  const where = label(tool.name, action);

  const keys = Object.keys(fields);
  let input: JsonObject;
  try {
    input = Object.fromEntries(keys.map((k) => [k, sampleValue(k, fields[k]!)]));
  } catch (err) {
    throw new Error(`${where}: ${errorMessage(err)}`);
  }
  if (literal !== undefined) input.action = literal;

  const calls: { method: string; path: string; query: string[] }[] = [];
  const client = {
    request: async (method: string, path: string, options: RequestOptions = {}) => {
      const query = Object.entries(options.query ?? {});
      calls.push({ method, path, query: query.filter(([, v]) => v !== undefined).map(([k]) => k) });
      return { object: 'list', has_more: false, next: null, data: [] };
    },
  } as unknown as RecurlyClient;
  const ctx: ToolContext = { client, config };

  try {
    await tool.handler(ctx, input);
  } catch (err) {
    // The canned list response isn't realistic, so a handler may reject it after
    // issuing its request (e.g. get_pdf expects PDF bytes). Only a failure before
    // any request means the sample input itself was rejected.
    if (calls.length === 0) {
      throw new Error(`${where}: handler rejected sample input: ${errorMessage(err)}`);
    }
  }
  const [call] = calls;
  if (calls.length !== 1 || !call) {
    throw new Error(`${where}: expected exactly one request, got ${calls.length}`);
  }
  if (call.method !== 'GET') throw new Error(`${where}: issued ${call.method}, expected GET`);

  const pathKeys = keys.filter((k) => call.path.includes(placeholder(k)));
  const local = LOCAL_PARAMS.get(where) ?? [];
  const dropped = keys.filter(
    (k) => !pathKeys.includes(k) && !call.query.includes(k) && !local.includes(k),
  );
  if (dropped.length > 0) {
    throw new Error(`${where}: accepts but never sends: ${dropped.join(', ')}`);
  }
  // e.g. a path key missing from fetchList's `omit` list.
  const leaked = pathKeys.filter((k) => call.query.includes(k));
  if (leaked.length > 0) {
    throw new Error(`${where}: sends path keys in the query too: ${leaked.join(', ')}`);
  }
  const path = pathKeys.reduce((p, k) => p.replaceAll(placeholder(k), `{${k}}`), call.path);
  return { tool: tool.name, action, path, params: [...call.query].sort() };
}

export async function deriveToolActions(
  tools: readonly ToolDefinition<z.ZodType>[],
): Promise<{ actions: ToolAction[]; errors: string[] }> {
  const actions: ToolAction[] = [];
  const errors: string[] = [];
  // Some handlers read config before issuing their request (get_pdf prepares
  // RECURLY_PDF_DIR), so run them against a real config with a throwaway dir.
  const pdfDir = await mkdtemp(join(tmpdir(), 'recurly-mcp-parity-'));
  try {
    const config = loadConfig({ RECURLY_API_KEY: 'parity', RECURLY_PDF_DIR: pdfDir });
    for (const tool of tools) {
      let options: z.ZodObject[];
      try {
        options = schemaOptions(tool.inputSchema);
      } catch (err) {
        errors.push(`${tool.name}: ${errorMessage(err)}`);
        continue;
      }
      for (const option of options) {
        try {
          actions.push(await deriveAction(tool, option, config));
        } catch (err) {
          errors.push(errorMessage(err));
        }
      }
    }
  } finally {
    await rm(pdfDir, { recursive: true, force: true });
  }
  return { actions, errors };
}

export function compareParity(
  specEndpoints: readonly SpecEndpoint[],
  actions: readonly ToolAction[],
  deriveErrors: readonly string[] = [],
): ParityReport {
  const ours = new Map<string, ToolAction[]>();
  for (const a of actions) {
    const key = templateKey(a.path);
    ours.set(key, [...(ours.get(key) ?? []), a]);
  }
  const specKeys = new Set(specEndpoints.map((e) => templateKey(e.path)));

  const report: ParityReport = {
    specEndpointCount: specEndpoints.length,
    missingEndpoints: [],
    missingParams: [],
    deriveErrors: [...deriveErrors],
    deprecatedMissingEndpoints: [],
    extraParams: [],
    unknownEndpoints: actions.filter((a) => !specKeys.has(templateKey(a.path))),
  };

  for (const endpoint of specEndpoints) {
    const covering = ours.get(templateKey(endpoint.path));
    if (!covering) {
      (endpoint.deprecated ? report.deprecatedMissingEndpoints : report.missingEndpoints).push(
        endpoint,
      );
      continue;
    }
    const specParams = new Set(endpoint.query);
    const accepted = new Set(covering.flatMap((a) => a.params));
    const missing = endpoint.query.filter((p) => !accepted.has(p) && !ALWAYS_ALLOWED_PARAMS.has(p));
    if (missing.length > 0) {
      report.missingParams.push({
        path: endpoint.path,
        actions: covering.map(actionLabel),
        params: missing,
      });
    }
    for (const a of covering) {
      const extra = a.params.filter((p) => !specParams.has(p) && !ALWAYS_ALLOWED_PARAMS.has(p));
      if (extra.length > 0) {
        report.extraParams.push({ path: endpoint.path, action: actionLabel(a), params: extra });
      }
    }
  }
  return report;
}

export function errorCount(report: ParityReport, strict: boolean): number {
  const base =
    report.missingEndpoints.length + report.missingParams.length + report.deriveErrors.length;
  if (!strict) return base;
  return (
    base +
    report.deprecatedMissingEndpoints.length +
    report.extraParams.length +
    report.unknownEndpoints.length
  );
}

export function formatReport(report: ParityReport, strict: boolean): string {
  const warn = strict ? 'ERROR' : 'WARN';
  const covered =
    report.specEndpointCount -
    report.missingEndpoints.length -
    report.deprecatedMissingEndpoints.length;
  const lines: string[] = [
    `Spec GET endpoints: ${report.specEndpointCount}, covered by our tools: ${covered}`,
  ];
  const section = (level: string, title: string, items: string[]): void => {
    if (items.length === 0) return;
    lines.push('', `${level} ${title} (${items.length}):`, ...items.map((i) => `  - ${i}`));
  };
  const opLabel = (e: SpecEndpoint): string =>
    e.operationId ? `${e.path} (${e.operationId})` : e.path;

  section('ERROR', 'could not derive tool endpoints', report.deriveErrors);
  section('ERROR', 'spec GET endpoints no tool covers', report.missingEndpoints.map(opLabel));
  section(
    'ERROR',
    'spec query params our actions do not accept',
    report.missingParams.map((m) => `${m.path} [${m.actions.join(', ')}]: ${m.params.join(', ')}`),
  );
  section(
    warn,
    'deprecated spec GET endpoints no tool covers',
    report.deprecatedMissingEndpoints.map(opLabel),
  );
  section(
    warn,
    'params our actions accept that the spec does not list',
    report.extraParams.map((x) => `${x.path} [${x.action}]: ${x.params.join(', ')}`),
  );
  section(
    warn,
    'endpoints our tools call that the spec does not list',
    report.unknownEndpoints.map((a) => `${a.path} [${actionLabel(a)}]`),
  );

  const errors = errorCount(report, strict);
  lines.push('', errors === 0 ? 'OK: no parity errors.' : `FAIL: ${errors} parity error(s).`);
  return lines.join('\n');
}
