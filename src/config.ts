export interface Config {
  apiKey: string;
  host: string;
  apiVersion: string;
  timeoutMs: number;
  maxRetries: number;
  maxOutputBytes: number;
}

// Recurly's two API regions. The host is the origin only; paths are appended
// by the client. RECURLY_HOST overrides this entirely (self-hosted mocks, EU
// vanity domains, proxies, tests).
const REGION_HOSTS: Record<string, string> = {
  us: 'https://v3.recurly.com',
  eu: 'https://v3.eu.recurly.com',
};

// The API version this server is built and tested against. Recurly pins
// behavior to the version sent in the Accept header. Overridable, but the
// tool paths/params here are modeled on v2021-02-25.
const DEFAULT_API_VERSION = 'v2021-02-25';

function parseIntEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max?: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`${name} must be an integer, got: ${raw}`);
  }
  if (n < min) {
    throw new Error(`${name} must be >= ${min}, got: ${n}`);
  }
  if (max !== undefined && n > max) {
    throw new Error(`${name} must be <= ${max}, got: ${n}`);
  }
  return n;
}

// Validate RECURLY_HOST is a parseable http(s) URL. Without this, a typo or
// attacker-controlled env (e.g. RECURLY_HOST=http://internal) silently ships
// the API key to a non-HTTPS host. We warn on http:// rather than reject
// because local mocks in dev are a legitimate use.
const HTTP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseHost(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`RECURLY_HOST is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`RECURLY_HOST must use http: or https:, got: ${url.protocol}`);
  }
  // The host is an origin only; a path/query/fragment would silently prefix or
  // corrupt every API path. Reject so the misconfiguration fails loudly.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(`RECURLY_HOST must be an origin only (no path/query/fragment), got: ${raw}`);
  }
  if (url.protocol === 'http:') {
    // Permit plaintext only for loopback (local mocks/dev). Refuse to ship the
    // API key in the clear to a remote host.
    if (!HTTP_LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `RECURLY_HOST may only use http: for a loopback host (localhost/127.0.0.1/[::1]); ` +
          `refusing to send the API key in plaintext to ${url.hostname}`,
      );
    }
    process.stderr.write(
      'recurly-mcp: warning: RECURLY_HOST uses http: (loopback) — API key sent in plaintext locally\n',
    );
  }
  return raw.replace(/\/+$/, '');
}

function resolveHost(hostRaw: string | undefined, regionRaw: string | undefined): string {
  if (hostRaw !== undefined && hostRaw !== '') return parseHost(hostRaw);
  const region = (regionRaw ?? 'us').toLowerCase();
  const host = REGION_HOSTS[region];
  if (!host) {
    throw new Error(
      `RECURLY_REGION must be one of: ${Object.keys(REGION_HOSTS).join(', ')}, got: ${regionRaw}`,
    );
  }
  return host;
}

// The version is interpolated raw into the Accept header
// (`application/vnd.recurly.<version>`); reject CR/LF (header injection) and
// require the documented `vYYYY-MM-DD` shape.
function parseApiVersion(raw: string | undefined): string {
  const value = raw ?? DEFAULT_API_VERSION;
  if (/[\r\n]/.test(value)) {
    throw new Error('RECURLY_API_VERSION must not contain CR or LF');
  }
  if (!/^v\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`RECURLY_API_VERSION must look like v2021-02-25, got: ${value}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  return {
    apiKey: env.RECURLY_API_KEY ?? '',
    host: resolveHost(env.RECURLY_HOST, env.RECURLY_REGION),
    apiVersion: parseApiVersion(env.RECURLY_API_VERSION),
    // timeoutMs must be positive — `setTimeout(abort, 0)` aborts every request.
    timeoutMs: parseIntEnv('RECURLY_TIMEOUT_MS', env.RECURLY_TIMEOUT_MS, 15000, 1),
    // maxRetries may be zero (disable retries) but not negative; cap at 10 so a
    // misconfiguration can't turn a single tool call into a multi-hour stall.
    maxRetries: parseIntEnv('RECURLY_MAX_RETRIES', env.RECURLY_MAX_RETRIES, 2, 0, 10),
    // Max UTF-8 bytes of a serialized tool result sent to the MCP client. Distinct
    // from the client's MAX_RESPONSE_BYTES (25 MB upstream-body OOM guard). Default
    // 75000 (~19k tokens) stays under the ~25k MCP result cap; floor 1000 keeps the
    // truncation envelopes themselves serviceable.
    maxOutputBytes: parseIntEnv(
      'RECURLY_MAX_OUTPUT_BYTES',
      env.RECURLY_MAX_OUTPUT_BYTES,
      75000,
      1000,
    ),
  };
}
