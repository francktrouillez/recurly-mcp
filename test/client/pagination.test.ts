import { describe, it, expect } from 'vitest';
import { extractCursor, withCursor } from '../../src/client/pagination.js';

describe('extractCursor', () => {
  it('extracts cursor from a relative next path', () => {
    expect(extractCursor('/accounts?cursor=abc123&limit=20')).toBe('abc123');
  });
  it('extracts cursor from an absolute url', () => {
    expect(extractCursor('https://v3.recurly.com/accounts?cursor=xyz')).toBe('xyz');
  });
  it('returns null when there is no cursor param', () => {
    expect(extractCursor('/accounts?limit=20')).toBeNull();
  });
  it('returns null for non-string / empty / malformed values', () => {
    expect(extractCursor(null)).toBeNull();
    expect(extractCursor(undefined)).toBeNull();
    expect(extractCursor('')).toBeNull();
    expect(extractCursor(42)).toBeNull();
  });
});

describe('withCursor', () => {
  it('adds a _pagination hint to a list payload', () => {
    const r = withCursor({ object: 'list', has_more: true, next: '/accounts?cursor=n1', data: [] });
    expect(r._pagination).toEqual({ has_more: true, next_cursor: 'n1' });
  });
  it('reports has_more false and null cursor at the end of a list', () => {
    const r = withCursor({ object: 'list', has_more: false, next: null, data: [1] });
    expect(r._pagination).toEqual({ has_more: false, next_cursor: null });
  });
  it('treats payloads with has_more/next as lists even without object:list', () => {
    const r = withCursor({ has_more: false, data: [] });
    expect(r._pagination).toBeDefined();
  });
  it('returns non-list payloads unchanged', () => {
    const obj = { object: 'account', id: 'a' };
    const r = withCursor(obj);
    expect(r).toEqual(obj);
    expect((r as Record<string, unknown>)._pagination).toBeUndefined();
  });
});
