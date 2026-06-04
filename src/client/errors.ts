// Bound the body rendered into the error MESSAGE. The full `body` is retained on
// the instance for programmatic callers, but the message is what gets forwarded
// to the MCP client, so a hostile/large upstream error body (up to the 25 MB
// read cap) must not be embedded verbatim.
const MAX_ERROR_BODY_CHARS = 2048;
function bodyForMessage(body: unknown): string {
  const s = JSON.stringify(body) ?? 'null';
  return s.length > MAX_ERROR_BODY_CHARS
    ? `${s.slice(0, MAX_ERROR_BODY_CHARS)}…[truncated ${s.length - MAX_ERROR_BODY_CHARS} chars]`
    : s;
}

export class RecurlyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`Recurly API error ${status} on ${method} ${path}: ${bodyForMessage(body)}`);
    this.name = 'RecurlyApiError';
  }
}

export class RecurlyNetworkError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly cause: unknown,
  ) {
    super(
      `Recurly network error on ${method} ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'RecurlyNetworkError';
  }
}

export class RecurlyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurlyConfigError';
  }
}
