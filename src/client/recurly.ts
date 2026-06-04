import type { Config } from '../config.js';
import { RecurlyApiError, RecurlyNetworkError } from './errors.js';

// This client is READ-ONLY by construction: the only HTTP method it will ever
// issue is GET. There is no code path to POST/PUT/PATCH/DELETE, so neither a
// jailbroken LLM nor the generic escape-hatch tool can mutate Recurly data.
export type HttpMethod = 'GET';

export type QueryValue = string | number | boolean | string[];

export interface RequestOptions {
  query?: Record<string, QueryValue | undefined>;
  headers?: Record<string, string>;
}

// A server-supplied Retry-After of `Fri, 31 Dec 9999 23:59:59 GMT` parses as a
// ~253-trillion-ms sleep — effectively a stall that holds the API key in
// memory and blocks the MCP client's tool call. Cap at 60s.
export const MAX_RETRY_DELAY_MS = 60_000;
// Reading a body with no size limit lets a malicious or compromised upstream
// send a multi-GB payload and OOM the Node process. 25 MB comfortably covers
// the largest realistic Recurly list response and most invoice PDFs.
export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

// Node's fetch (undici) appends a default `Accept-Language: *` whenever the
// request sets none. Recurly validates this header strictly and rejects `*`
// with a 406 ("The Accept-Language header is not valid."). Sending a concrete
// locale keeps undici from ever falling back to the wildcard. Callers may
// override it (Recurly uses it to localize transaction error messages).
export const DEFAULT_ACCEPT_LANGUAGE = 'en-US';

// Recurly serializes array query parameters as comma-separated values
// (e.g. `ids=a,b,c`), matching the official client libraries.
function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      params.set(k, v.join(','));
    } else {
      params.set(k, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function isRetriable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// Recurly returns JSON for everything except invoice PDFs (application/pdf).
// Treat any non-JSON, non-text content type as binary so it can be base64-wrapped
// rather than mangled by UTF-8 decoding.
function isBinaryContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  if (lower === '') return false;
  if (lower.includes('json')) return false;
  if (lower.startsWith('text/')) return false;
  return true;
}

// Retry-After (RFC 7231 §7.1.3) is either delta-seconds or an HTTP-date.
// Returns ms to wait, or null if the header is absent or unparseable.
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now);
  return null;
}

// Equal-jitter exponential backoff: random delay between 50% and 100% of
// 2^attempt * baseMs. Avoids thundering-herd retries under concurrent load.
export function backoffMs(attempt: number, baseMs: number = 250): number {
  const exp = 2 ** attempt * baseMs;
  return exp * 0.5 + Math.random() * exp * 0.5;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Strip security-sensitive headers from user-supplied input and normalize
// remaining keys to lowercase. Without this, a case-variant `Authorization`
// header from an LLM survives as a distinct object key and Node's Headers
// constructor *appends* duplicate-name headers — the wire ends up sending
// `Authorization: <attacker>, Basic <real_key>`. Stripping host/cookie closes
// related abuse vectors against the fixed-host destination.
const RESERVED_HEADERS = new Set(['authorization', 'host', 'cookie']);

function sanitizeUserHeaders(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const lower = k.toLowerCase();
    if (RESERVED_HEADERS.has(lower)) continue;
    out[lower] = v;
  }
  return out;
}

// Parse upstream JSON while dropping any literal `__proto__` key. JSON.parse
// never pollutes the prototype on its own, but a `__proto__` property in the
// payload would otherwise be copied through our object spreads (responseGuard,
// pagination) and surface in the output we return to the MCP client. Dropping
// it via the reviver keeps responses clean without affecting normal fields.
function parseJsonSafe(text: string): unknown {
  return JSON.parse(text, (key, value) => (key === '__proto__' ? undefined : value));
}

export class RecurlyClient {
  constructor(private readonly config: Config) {}

  // Recurly uses HTTP Basic auth with the private API key as the username and
  // an empty password.
  private authHeader(): string {
    const token = Buffer.from(`${this.config.apiKey}:`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  async request(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<unknown> {
    const url = `${this.config.host}${path}${buildQuery(options.query)}`;
    // `accept-language` is placed before the spread so a caller MAY override it
    // (Recurly localizes some messages by it). `accept` (API version),
    // `user-agent`, and `authorization` are pinned AFTER the spread so no
    // user-supplied header can change the API version, client identity, or
    // credentials.
    const headers: Record<string, string> = {
      'accept-language': DEFAULT_ACCEPT_LANGUAGE,
      ...sanitizeUserHeaders(options.headers),
      accept: `application/vnd.recurly.${this.config.apiVersion}`,
      'user-agent': 'recurly-mcp',
    };
    if (!this.config.apiKey) {
      throw new RecurlyApiError(401, method, path, {
        message: 'RECURLY_API_KEY env var is required',
      });
    }
    headers.authorization = this.authHeader();

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      // The timer is cleared only in `finally`, so the abort signal covers BOTH
      // the fetch and the body read. A slow/hostile upstream that trickles the
      // response body therefore cannot hang the process past timeoutMs.
      try {
        let response: Response;
        try {
          response = await fetch(url, {
            method,
            headers,
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch (err) {
          if (attempt < this.config.maxRetries) {
            await sleep(backoffMs(attempt));
            attempt++;
            continue;
          }
          throw new RecurlyNetworkError(method, path, err);
        }

        // Refuse to follow redirects. A 3xx to another origin (or even the same
        // origin) would resend the Authorization header to an unintended target.
        // With redirect:'manual' undici yields an opaqueredirect (or the raw
        // 3xx status); treat either as an error rather than following it.
        if (
          response.type === 'opaqueredirect' ||
          (response.status >= 300 && response.status < 400)
        ) {
          throw new RecurlyNetworkError(
            method,
            path,
            new Error(`refused to follow redirect (status ${response.status})`),
          );
        }

        if (isRetriable(response.status) && attempt < this.config.maxRetries) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          const rawDelay = retryAfterMs !== null ? retryAfterMs : backoffMs(attempt);
          const delay = Math.min(MAX_RETRY_DELAY_MS, rawDelay);
          await sleep(delay);
          attempt++;
          continue;
        }

        if (response.status === 204) return null;

        let bytes: Uint8Array;
        try {
          bytes = await readBodyBytesWithLimit(response, MAX_RESPONSE_BYTES);
        } catch (err) {
          throw new RecurlyApiError(response.status, method, path, {
            message: err instanceof Error ? err.message : String(err),
          });
        }

        const contentType = response.headers.get('content-type') ?? '';

        if (!response.ok) {
          const text = new TextDecoder('utf-8').decode(bytes);
          let parsed: unknown = null;
          if (text.length > 0) {
            try {
              parsed = parseJsonSafe(text);
            } catch {
              parsed = text;
            }
          }
          throw new RecurlyApiError(response.status, method, path, parsed);
        }

        if (bytes.length === 0) return null;

        if (isBinaryContentType(contentType)) {
          // e.g. invoice PDFs. Return a structured wrapper rather than a mangled
          // string so the caller can decode the bytes losslessly.
          return {
            object: 'binary_file',
            content_type: contentType,
            encoding: 'base64',
            byte_length: bytes.length,
            data: Buffer.from(bytes).toString('base64'),
          };
        }

        const text = new TextDecoder('utf-8').decode(bytes);
        try {
          return parseJsonSafe(text);
        } catch {
          return text;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

// Reads the body via a streaming reader and aborts if it exceeds `max` bytes.
// Pre-checks Content-Length to fail fast when the server is honest about size.
// Returns the raw bytes so the caller can JSON-parse text or base64 binary.
// Exported for direct testing — the production cap (25 MB) is too large to
// allocate in a unit test, so tests exercise the cap logic with a small max.
export async function readBodyBytesWithLimit(response: Response, max: number): Promise<Uint8Array> {
  const cl = response.headers.get('content-length');
  if (cl !== null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > max) {
      throw new Error(`response body exceeds ${max} bytes (Content-Length: ${n})`);
    }
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > max) {
          await reader.cancel();
          throw new Error(`response body exceeds ${max} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released by cancel(); ignore
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
