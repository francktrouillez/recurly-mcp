import { describe, it, expect } from 'vitest';
import {
  RecurlyApiError,
  RecurlyNetworkError,
  RecurlyConfigError,
} from '../../src/client/errors.js';

describe('error classes', () => {
  it('RecurlyApiError carries status/method/path/body and is an Error', () => {
    const e = new RecurlyApiError(404, 'GET', '/accounts/x', { error: { message: 'no' } });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('RecurlyApiError');
    expect(e.status).toBe(404);
    expect(e.method).toBe('GET');
    expect(e.path).toBe('/accounts/x');
    expect(e.message).toContain('404');
    expect(e.message).toContain('/accounts/x');
  });

  it('truncates a very large body in the message but preserves the body field', () => {
    const big = { blob: 'x'.repeat(100_000) };
    const e = new RecurlyApiError(400, 'GET', '/x', big);
    expect(e.message).toContain('400');
    expect(e.message.length).toBeLessThan(4000); // message bounded
    expect(e.message).toContain('truncated');
    expect((e.body as { blob: string }).blob.length).toBe(100_000); // body field intact for callers
  });

  it('RecurlyNetworkError wraps the cause message', () => {
    const e = new RecurlyNetworkError('GET', '/x', new Error('ECONNRESET'));
    expect(e.name).toBe('RecurlyNetworkError');
    expect(e.message).toContain('ECONNRESET');
  });

  it('RecurlyConfigError sets name and message', () => {
    const e = new RecurlyConfigError('bad config');
    expect(e.name).toBe('RecurlyConfigError');
    expect(e.message).toBe('bad config');
  });
});
