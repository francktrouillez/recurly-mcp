import { z } from 'zod';
import type { QueryValue } from '../client/recurly.js';
import { withCursor } from '../client/pagination.js';
import type { ToolContext } from './types.js';

// Recurly path parameters are either an opaque object ID (e.g. `e28zov4fw0v2`)
// or a human key with a prefix: `code-myplan`, `subdomain-acme`. We URL-encode
// every interpolated value (matching the official clients), which turns any
// `/` into `%2F` and neutralizes path-segment escapes. encodeURIComponent does
// NOT touch `.`, so a literal `.`/`..` segment is rejected explicitly below.
export const enc = (value: string | number): string => encodeURIComponent(String(value));

// A reusable schema for a path-parameter (ID or code). Rejects blanks, CR/LF,
// and the two raw values (`.` / `..`) that survive encodeURIComponent and could
// otherwise collapse to a parent path once fetch normalizes the URL.
export const idParam = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => v.trim() !== '', `${label} must not be blank`)
    .refine((v) => !/[\r\n]/.test(v), `${label} must not contain CR or LF`)
    .refine((v) => v !== '.' && v !== '..', `${label} must not be a path-traversal segment`)
    .describe(
      `${label}: a Recurly object ID or prefixed code (e.g. "code-myplan", "subdomain-acme"). Special characters are URL-encoded automatically.`,
    );

// An optional enum param: the exact values Recurly allows for it.
export const optionalEnum = <const T extends readonly [string, ...string[]]>(
  values: T,
  description: string,
) => z.enum(values).optional().describe(description);

// Pagination cursor. Every list action accepts it: Recurly hands it back in the
// `next` link of any list response, whether or not the endpoint documents it.
const cursor = z
  .string()
  .max(1024)
  .optional()
  .describe("Pagination cursor from a prior response's _pagination.next_cursor.");

// The common pagination/filtering query params of Recurly list endpoints. Not
// every endpoint accepts every one (gift cards accept none, billing infos have
// no limit/order, …), so each list action picks exactly what its endpoint
// documents via `listParams(...)`. All optional; only sent when provided.
// Resource-specific filters (state, type, …) are merged on top per tool.
const listParamShapes = {
  limit: z.number().int().min(1).max(200).optional().describe('Page size, 1–200.'),
  order: optionalEnum(['asc', 'desc'], 'Sort direction.'),
  sort: optionalEnum(
    ['created_at', 'updated_at'],
    'Sort field (ascending updated_at pages most reliably).',
  ),
  ids: z
    .array(
      z
        .string()
        .min(1)
        .max(256)
        .refine((s) => !s.includes(','), 'id must not contain a comma'),
    )
    .max(200)
    .optional()
    .describe('Filter by up to 200 IDs (sent as a comma-separated list).'),
  begin_time: z.string().max(64).optional().describe('ISO 8601 lower bound on the sort field.'),
  end_time: z.string().max(64).optional().describe('ISO 8601 upper bound on the sort field.'),
};

// Shape for a list action: the named common params plus `cursor`. Merge it into
// a branch with `.extend(listParams('ids', 'sort'))`.
export function listParams<K extends keyof typeof listParamShapes>(
  ...names: K[]
): Pick<typeof listParamShapes, K> & { cursor: typeof cursor } {
  const picked = Object.fromEntries(names.map((name) => [name, listParamShapes[name]]));
  return { ...(picked as Pick<typeof listParamShapes, K>), cursor };
}

// The full set, accepted by most Recurly list endpoints.
export const standardListParams = { ...listParamShapes, cursor };

// Turn a parsed discriminated-union branch into a query object: drop the
// `action` discriminator and any path-parameter keys (which belong in the URL,
// not the query string), and skip undefined values.
export function listQuery(
  parsed: Record<string, unknown>,
  omit: readonly string[] = [],
): Record<string, QueryValue | undefined> {
  const out: Record<string, QueryValue | undefined> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k === 'action' || omit.includes(k)) continue;
    if (v === undefined) continue;
    out[k] = v as QueryValue;
  }
  return out;
}

// Issue a GET to a Recurly list endpoint and attach the cursor-pagination hint.
// `omit` lists the path-parameter keys to keep out of the query string.
export async function fetchList(
  ctx: ToolContext,
  path: string,
  parsed: Record<string, unknown>,
  omit: readonly string[] = [],
): Promise<unknown> {
  const payload = (await ctx.client.request('GET', path, {
    query: listQuery(parsed, omit),
  })) as Record<string, unknown>;
  return withCursor(payload);
}
