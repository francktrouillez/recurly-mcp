import { describe, it, expect } from 'vitest';
import { requestTool } from '../../src/tools/request.js';

describe('recurly_request path validation', () => {
  const parse = (path: string) => requestTool.inputSchema.parse({ path });

  it('accepts normal Recurly API paths', () => {
    expect(parse('/accounts').path).toBe('/accounts');
    expect(parse('/accounts/code-x/invoices').path).toBe('/accounts/code-x/invoices');
  });

  it('requires a leading slash', () => {
    expect(() => parse('accounts')).toThrow();
  });

  it('rejects raw, single-encoded, double-encoded, and backslash ".." traversal', () => {
    expect(() => parse('/x/../y')).toThrow();
    expect(() => parse('/x/%2e%2e/y')).toThrow();
    expect(() => parse('/x/%252e%252e/y')).toThrow();
    expect(() => parse('/x/..\\y')).toThrow();
  });

  it('rejects CR/LF in header values', () => {
    expect(() =>
      requestTool.inputSchema.parse({ path: '/x', headers: { 'X-Y': 'a\r\nb' } }),
    ).toThrow();
  });
});
