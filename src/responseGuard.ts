// Caps the size of a tool result before it is serialized to the MCP client.
// The MCP transport imposes a per-result token budget; an unbounded `list`
// (up to 200 full Recurly objects) can blow past it, at which point the client
// spills the result to a file and the model loses inline visibility. This guard
// keeps every result within `maxBytes` of compact JSON.
//
// SEPARATE from the client's MAX_RESPONSE_BYTES (25 MB), which limits the
// upstream HTTP body for OOM protection. This limits what we EMIT to the client.

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function safeStringify(value: unknown): string {
  // JSON.stringify yields undefined for undefined / functions / symbols.
  const s: string | undefined = JSON.stringify(value);
  return s ?? 'null';
}

const TOO_LARGE_REASON = 'response_exceeded_max_bytes';

// Generous reservation for the list envelope (object/has_more/next/_pagination/
// _truncated + hint). Correctness does NOT depend on this estimate — truncateList
// does a final fit check and drops items until the assembled JSON is in budget.
const LIST_ENVELOPE_HEADROOM = 4096;

interface ListResult {
  object: 'list';
  data: unknown[];
  // Recurly lists carry passthrough fields (has_more, next, _pagination, …) that
  // we preserve verbatim via spread but don't model individually.
  [key: string]: unknown;
}

function isListResult(value: unknown): value is ListResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).object === 'list' &&
    Array.isArray((value as Record<string, unknown>).data)
  );
}

function truncationHint(returned: number, total: number): string {
  return (
    `Showing the first ${returned} of ${total} items on this page to stay within ` +
    'the size limit. Re-request with a smaller `limit`, add filters (e.g. state, ids, ' +
    'begin_time), or page using the cursor in _pagination.'
  );
}

// Fallback when a list's passthrough fields (long cursor/URL, custom keys) alone
// exceed the budget: drop them entirely so the output still respects `maxBytes`.
function minimalListEnvelope(total: number, maxBytes: number): Record<string, unknown> {
  return {
    object: 'list',
    data: [],
    _truncated: {
      reason: TOO_LARGE_REASON,
      max_bytes: maxBytes,
      returned_items: 0,
      omitted_items: total,
      hint: truncationHint(0, total),
    },
  };
}

function buildListEnvelope(
  result: ListResult,
  kept: unknown[],
  total: number,
  maxBytes: number,
): Record<string, unknown> {
  // Spread preserves passthrough fields (object/has_more/next/_pagination);
  // `data` is replaced with the kept slice.
  return {
    ...result,
    data: kept,
    _truncated: {
      reason: TOO_LARGE_REASON,
      max_bytes: maxBytes,
      returned_items: kept.length,
      omitted_items: total - kept.length,
      hint: truncationHint(kept.length, total),
    },
  };
}

function truncateList(result: ListResult, maxBytes: number): Record<string, unknown> {
  const items = result.data;
  const itemBudget = Math.max(0, maxBytes - LIST_ENVELOPE_HEADROOM);

  const kept: unknown[] = [];
  let used = 0;
  for (const item of items) {
    const size = byteLength(safeStringify(item)) + 1; // +1 ≈ comma separator
    if (used + size > itemBudget) break;
    kept.push(item);
    used += size;
  }

  let envelope = buildListEnvelope(result, kept, items.length, maxBytes);
  // Final fit: drop trailing items until the assembled JSON fits. Guarantees
  // correctness regardless of the headroom estimate.
  while (kept.length > 0 && byteLength(safeStringify(envelope)) > maxBytes) {
    kept.pop();
    envelope = buildListEnvelope(result, kept, items.length, maxBytes);
  }
  // If passthrough fields alone blow the budget, fall back to a minimal envelope.
  if (byteLength(safeStringify(envelope)) > maxBytes) {
    return minimalListEnvelope(items.length, maxBytes);
  }
  return envelope;
}

const TOO_LARGE_HINT =
  'This single resource exceeds the inline size limit and was not returned in full. ' +
  'Fetch a narrower sub-resource or specific record. Invoice PDFs (action=get_pdf) ' +
  'are large by nature.';

function tooLargeEnvelope(
  result: unknown,
  maxBytes: number,
  actualBytes: number,
): Record<string, unknown> {
  const obj =
    typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
  const inner: Record<string, unknown> = {
    reason: TOO_LARGE_REASON,
    max_bytes: maxBytes,
    actual_bytes: actualBytes,
    // Bound the only variable-length fields so the envelope itself always stays
    // within `maxBytes` (mirrors the list path's minimalListEnvelope guarantee).
    object: typeof obj.object === 'string' ? obj.object.slice(0, 200) : typeof result,
    id:
      typeof obj.id === 'string'
        ? obj.id.slice(0, 200)
        : typeof obj.code === 'string'
          ? obj.code.slice(0, 200)
          : null,
    hint: TOO_LARGE_HINT,
  };
  // For invoice-PDF style binary wrappers, surface metadata without the base64.
  if (obj.object === 'binary_file') {
    inner.content_type = obj.content_type ?? null;
    inner.byte_length = obj.byte_length ?? null;
    inner.encoding = obj.encoding ?? null;
  }
  return { _response_too_large: inner };
}

// Serialize `result` compactly, capping the output at `maxBytes` UTF-8 bytes.
export function shapeResult(result: unknown, maxBytes: number): string {
  const full = safeStringify(result);
  if (byteLength(full) <= maxBytes) return full;
  if (isListResult(result)) return safeStringify(truncateList(result, maxBytes));
  return safeStringify(tooLargeEnvelope(result, maxBytes, byteLength(full)));
}
