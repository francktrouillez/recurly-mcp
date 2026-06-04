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

// Common cursor-pagination + filtering params shared by every `list` action.
// All optional; only sent when provided. Resource-specific filters (state,
// type, …) are merged on top per tool.
export const listParamsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional().describe('Page size, 1–200.'),
  order: z.enum(['asc', 'desc']).optional().describe('Sort direction.'),
  sort: z.string().max(64).optional().describe('Sort field, typically created_at or updated_at.'),
  cursor: z
    .string()
    .max(1024)
    .optional()
    .describe("Pagination cursor from a prior response's _pagination.next_cursor."),
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
  begin_time: z
    .string()
    .max(64)
    .optional()
    .describe('ISO 8601 lower bound (used with sort=created_at|updated_at).'),
  end_time: z
    .string()
    .max(64)
    .optional()
    .describe('ISO 8601 upper bound (used with sort=created_at|updated_at).'),
});

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
