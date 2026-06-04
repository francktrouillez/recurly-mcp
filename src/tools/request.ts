import { z } from 'zod';
import type { RequestOptions } from '../client/recurly.js';
import type { ToolDefinition } from './types.js';

// The URL is built by raw string concatenation (`${host}${path}${query}`) and
// then handed to fetch, which normalizes `..` segments per WHATWG URL parsing.
// A guard like `startsWith('/')` is satisfied by `/x/../../admin` — after
// normalization the request would hit a different path with the API key
// attached. Reject any `..` segment after percent-decoding to close the bypass.
const pathSchema = z
  .string()
  .startsWith('/', 'path must start with / (a Recurly API path)')
  .refine((p) => {
    // Decode repeatedly until stable so multiply-encoded traversal
    // (e.g. `%252e%252e`) cannot slip a `..` segment past this check.
    let decoded = p;
    for (let i = 0; i < 5; i++) {
      let next: string;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        return false;
      }
      if (next === decoded) break;
      decoded = next;
    }
    return !decoded.split(/[/\\]/).includes('..');
  }, 'path must not contain ".." traversal (raw or percent-encoded)')
  .describe('Recurly API path, e.g. /accounts or /accounts/code-myaccount/invoices');

// Header values must not contain CR or LF (request-splitting / header injection).
const headerValueSchema = z
  .string()
  .refine((v) => !/[\r\n]/.test(v), 'header values must not contain CR or LF');

const inputSchema = z.object({
  path: pathSchema,
  query: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .optional()
    .describe('Query parameters. Arrays are serialized as comma-separated values.'),
  headers: z.record(headerValueSchema).optional(),
});

export const requestTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_request',
  description:
    'Escape hatch: send a raw GET request to any Recurly API endpoint. This server is read-only — only GET is supported, so this cannot mutate data. Use when no resource-specific tool covers what you need (e.g. an endpoint or filter not modeled here). Returns the raw Recurly JSON payload — no data is removed.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    const opts: RequestOptions = {};
    if (parsed.query !== undefined) opts.query = parsed.query;
    if (parsed.headers !== undefined) opts.headers = parsed.headers;
    return ctx.client.request('GET', parsed.path, opts);
  },
};
