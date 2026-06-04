import { describe, it, expect } from 'vitest';
import { shapeResult } from '../src/responseGuard.js';

function makeList(n: number, pad: number) {
  const data = Array.from({ length: n }, (_, i) => ({ id: `item_${i}`, blob: 'x'.repeat(pad) }));
  return {
    object: 'list',
    has_more: true,
    next: '/next',
    _pagination: { next_cursor: 'cur_1' },
    data,
  };
}

describe('shapeResult', () => {
  it('returns compact JSON unchanged when under budget', () => {
    const obj = { object: 'plan', id: 'p1', name: 'Basic' };
    const out = shapeResult(obj, 75000);
    expect(out).toBe(JSON.stringify(obj));
    expect(out).not.toContain('\n');
  });

  it('truncates a large list to whole items within budget and preserves the cursor', () => {
    const list = makeList(200, 500);
    const max = 8000;
    const out = shapeResult(list, max);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(max);
    const parsed = JSON.parse(out);
    expect(parsed.object).toBe('list');
    expect(parsed._pagination).toEqual({ next_cursor: 'cur_1' });
    expect(parsed.data.length).toBeGreaterThan(0);
    expect(parsed.data.length).toBeLessThan(200);
    expect(parsed.data[0]).toEqual(list.data[0]); // kept items are whole
    expect(parsed._truncated.returned_items).toBe(parsed.data.length);
    expect(parsed._truncated.omitted_items).toBe(200 - parsed.data.length);
    expect(parsed._truncated.reason).toBe('response_exceeded_max_bytes');
  });

  it('degrades to zero items when even the first item exceeds budget', () => {
    const out = shapeResult(makeList(5, 5000), 2000);
    const parsed = JSON.parse(out);
    expect(parsed.data).toEqual([]);
    expect(parsed._truncated.returned_items).toBe(0);
    expect(parsed._truncated.omitted_items).toBe(5);
  });

  it('returns a list unchanged when under budget', () => {
    const list = makeList(2, 10);
    const out = shapeResult(list, 75000);
    expect(JSON.parse(out)).toEqual(list);
  });

  it('respects the budget even when list passthrough fields alone exceed it', () => {
    const list = {
      object: 'list',
      huge: 'x'.repeat(5000),
      _pagination: { next_cursor: 'c' },
      data: [{ id: 'a' }],
    };
    const out = shapeResult(list, 1500);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(1500);
    const parsed = JSON.parse(out);
    expect(parsed.data).toEqual([]);
    expect(parsed._truncated.returned_items).toBe(0);
    expect(parsed._truncated.omitted_items).toBe(1);
  });

  it('wraps an oversized single object in a _response_too_large envelope', () => {
    const obj = { object: 'invoice', id: 'inv_1', blob: 'x'.repeat(50000) };
    const out = shapeResult(obj, 4000);
    const parsed = JSON.parse(out);
    expect(parsed._response_too_large.object).toBe('invoice');
    expect(parsed._response_too_large.id).toBe('inv_1');
    expect(parsed._response_too_large.reason).toBe('response_exceeded_max_bytes');
    expect(parsed._response_too_large.actual_bytes).toBeGreaterThan(4000);
  });

  it('surfaces binary_file metadata without the base64 data', () => {
    const bin = {
      object: 'binary_file',
      content_type: 'application/pdf',
      encoding: 'base64',
      byte_length: 999999,
      data: 'A'.repeat(60000),
    };
    const out = shapeResult(bin, 4000);
    const parsed = JSON.parse(out);
    expect(parsed._response_too_large.content_type).toBe('application/pdf');
    expect(parsed._response_too_large.byte_length).toBe(999999);
    expect(parsed._response_too_large.encoding).toBe('base64');
    expect(out).not.toContain('AAAA'); // base64 payload dropped
    expect(parsed._response_too_large.id).toBeNull(); // no id/code on a binary wrapper
  });

  it('falls back to `code` for the id when an oversized object has no id', () => {
    const obj = { object: 'plan', code: 'basic', blob: 'x'.repeat(50000) };
    const parsed = JSON.parse(shapeResult(obj, 4000));
    expect(parsed._response_too_large.object).toBe('plan');
    expect(parsed._response_too_large.id).toBe('basic');
  });

  it('wraps an oversized primitive (non-object) result in the envelope', () => {
    const parsed = JSON.parse(shapeResult('x'.repeat(5000), 100));
    expect(parsed._response_too_large.object).toBe('string');
    expect(parsed._response_too_large.id).toBeNull();
  });

  it('keeps the too-large envelope within budget even for a pathologically long id', () => {
    const obj = { object: 'invoice', id: 'x'.repeat(5000), blob: 'y'.repeat(50000) };
    const out = shapeResult(obj, 1000);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(out);
    expect(parsed._response_too_large.object).toBe('invoice');
    expect(parsed._response_too_large.id.length).toBeLessThanOrEqual(200);
  });
});
