// Recurly uses cursor-based pagination. A list response looks like:
//   { "object": "list", "has_more": true, "next": "/accounts?cursor=…&limit=…", "data": [ … ] }
// To fetch the next page the caller re-issues the same list action with the
// `cursor` extracted from `next`. We surface that cursor in a `_pagination`
// hint so the model doesn't have to parse the `next` URL itself.

export interface CursorMeta {
  has_more: boolean;
  next_cursor: string | null;
}

// `next` may be a relative path (`/accounts?cursor=…`) or an absolute URL.
// Parse it against a dummy base and pull out the `cursor` query param.
export function extractCursor(next: unknown): string | null {
  if (typeof next !== 'string' || next === '') return null;
  try {
    const url = new URL(next, 'https://v3.recurly.com');
    return url.searchParams.get('cursor');
  } catch {
    return null;
  }
}

// Attach a `_pagination` hint to a Recurly list payload. Non-list payloads are
// returned unchanged.
export function withCursor<T extends Record<string, unknown>>(
  payload: T,
): T & { _pagination?: CursorMeta } {
  if (!payload || typeof payload !== 'object') return payload;
  const isList = payload['object'] === 'list' || 'has_more' in payload || 'next' in payload;
  if (!isList) return payload;
  const meta: CursorMeta = {
    has_more: payload['has_more'] === true,
    next_cursor: extractCursor(payload['next']),
  };
  return { ...payload, _pagination: meta };
}
