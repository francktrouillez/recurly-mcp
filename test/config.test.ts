import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies defaults (US host, pinned version, timeout, retries)', () => {
    expect(loadConfig({ RECURLY_API_KEY: 'k' })).toMatchObject({
      apiKey: 'k',
      host: 'https://v3.recurly.com',
      apiVersion: 'v2021-02-25',
      timeoutMs: 15000,
      maxRetries: 2,
    });
  });

  it('defaults apiKey to empty string when unset', () => {
    expect(loadConfig({}).apiKey).toBe('');
  });

  it('resolves the EU region host (case-insensitively)', () => {
    expect(loadConfig({ RECURLY_REGION: 'eu' }).host).toBe('https://v3.eu.recurly.com');
    expect(loadConfig({ RECURLY_REGION: 'EU' }).host).toBe('https://v3.eu.recurly.com');
  });

  it('throws on an unknown region', () => {
    expect(() => loadConfig({ RECURLY_REGION: 'mars' })).toThrow(/RECURLY_REGION/);
  });

  it('RECURLY_HOST overrides region and strips a trailing slash', () => {
    expect(loadConfig({ RECURLY_REGION: 'eu', RECURLY_HOST: 'https://mock.test/' }).host).toBe(
      'https://mock.test',
    );
  });

  it('throws on a non-URL RECURLY_HOST and on a non-http(s) scheme', () => {
    expect(() => loadConfig({ RECURLY_HOST: 'not a url' })).toThrow(/valid URL/);
    expect(() => loadConfig({ RECURLY_HOST: 'ftp://x.test' })).toThrow(/http/);
  });

  it('warns to stderr (but accepts) an http RECURLY_HOST', () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    const cfg = loadConfig({ RECURLY_HOST: 'http://localhost:3000' });
    expect(cfg.host).toBe('http://localhost:3000');
    expect(writes.some((s) => /http:/.test(s))).toBe(true);
  });

  it('accepts a valid apiVersion override and rejects malformed / CRLF ones', () => {
    expect(loadConfig({ RECURLY_API_VERSION: 'v2019-10-10' }).apiVersion).toBe('v2019-10-10');
    expect(() => loadConfig({ RECURLY_API_VERSION: '2021-02-25' })).toThrow(/RECURLY_API_VERSION/);
    expect(() => loadConfig({ RECURLY_API_VERSION: 'v2021-02-25\r\nX: y' })).toThrow();
  });

  it('parses timeout/retries and enforces their bounds', () => {
    expect(loadConfig({ RECURLY_TIMEOUT_MS: '500', RECURLY_MAX_RETRIES: '0' })).toMatchObject({
      timeoutMs: 500,
      maxRetries: 0,
    });
    expect(() => loadConfig({ RECURLY_TIMEOUT_MS: '0' })).toThrow(/>= 1/);
    expect(() => loadConfig({ RECURLY_MAX_RETRIES: '-1' })).toThrow(/>= 0/);
    expect(() => loadConfig({ RECURLY_TIMEOUT_MS: 'abc' })).toThrow(/integer/);
  });

  it('caps RECURLY_MAX_RETRIES to prevent multi-hour stalls', () => {
    expect(loadConfig({ RECURLY_MAX_RETRIES: '10' }).maxRetries).toBe(10);
    expect(() => loadConfig({ RECURLY_MAX_RETRIES: '1000' })).toThrow(/<= 10/);
  });

  it('rejects a RECURLY_HOST with a path/query/fragment (origin only)', () => {
    expect(() => loadConfig({ RECURLY_HOST: 'https://v3.recurly.com/extra' })).toThrow(/origin/);
    expect(() => loadConfig({ RECURLY_HOST: 'https://v3.recurly.com/?x=1' })).toThrow(/origin/);
  });

  it('allows http only for loopback hosts, rejecting remote plaintext', () => {
    expect(loadConfig({ RECURLY_HOST: 'http://127.0.0.1:3000' }).host).toBe(
      'http://127.0.0.1:3000',
    );
    expect(() => loadConfig({ RECURLY_HOST: 'http://evil.example.com' })).toThrow(/loopback/);
  });

  it('defaults maxOutputBytes and honors RECURLY_MAX_OUTPUT_BYTES (with a floor)', () => {
    expect(loadConfig({ RECURLY_API_KEY: 'k' })).toMatchObject({ maxOutputBytes: 75000 });
    expect(loadConfig({ RECURLY_MAX_OUTPUT_BYTES: '20000' })).toMatchObject({
      maxOutputBytes: 20000,
    });
    expect(() => loadConfig({ RECURLY_MAX_OUTPUT_BYTES: '500' })).toThrow(/>= 1000/);
  });
});
