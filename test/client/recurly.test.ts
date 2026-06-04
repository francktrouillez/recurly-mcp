import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import {
  RecurlyClient,
  MAX_RESPONSE_BYTES,
  MAX_RETRY_DELAY_MS,
  backoffMs,
  parseRetryAfter,
  readBodyBytesWithLimit,
} from '../../src/client/recurly.js';
import { RecurlyApiError, RecurlyNetworkError } from '../../src/client/errors.js';

const baseConfig = {
  apiKey: 'tok_abc',
  host: 'https://v3.recurly.com',
  apiVersion: 'v2021-02-25',
  timeoutMs: 5000,
  maxRetries: 2,
  maxOutputBytes: 75000,
};
const expectedAuth = 'Basic ' + Buffer.from('tok_abc:').toString('base64');

describe('RecurlyClient', () => {
  beforeEach(() => nock.cleanAll());
  afterEach(() => nock.cleanAll());

  it('sends Basic auth and the version Accept header on GET', async () => {
    nock('https://v3.recurly.com', {
      reqheaders: { authorization: expectedAuth, accept: 'application/vnd.recurly.v2021-02-25' },
    })
      .get('/accounts')
      .reply(200, { object: 'list', data: [] });
    const client = new RecurlyClient(baseConfig);
    expect(await client.request('GET', '/accounts')).toEqual({ object: 'list', data: [] });
  });

  // Regression: when no Accept-Language is set, undici (Node's fetch) appends
  // its default `Accept-Language: *`, which Recurly rejects with a 406
  // ("The Accept-Language header is not valid."). The client must always send a
  // concrete locale so that wildcard default never reaches Recurly.
  it('sends a concrete Accept-Language so undici never falls back to "*"', async () => {
    nock('https://v3.recurly.com', {
      reqheaders: { 'accept-language': 'en-US' },
    })
      .get('/plans')
      .reply(200, { object: 'list', data: [] });
    const client = new RecurlyClient(baseConfig);
    expect(await client.request('GET', '/plans')).toEqual({ object: 'list', data: [] });
  });

  it('serializes query params and arrays as CSV', async () => {
    nock('https://v3.recurly.com')
      .get('/accounts')
      .query({ limit: '10', ids: 'a,b,c', subscriber: 'true' })
      .reply(200, { ok: true });
    const client = new RecurlyClient(baseConfig);
    expect(
      await client.request('GET', '/accounts', {
        query: { limit: 10, ids: ['a', 'b', 'c'], subscriber: true },
      }),
    ).toEqual({ ok: true });
  });

  it('throws RecurlyApiError on 4xx with the error body', async () => {
    nock('https://v3.recurly.com')
      .get('/accounts/nope')
      .reply(404, { error: { type: 'not_found', message: 'not found' } });
    const client = new RecurlyClient(baseConfig);
    await expect(client.request('GET', '/accounts/nope')).rejects.toMatchObject({
      name: 'RecurlyApiError',
      status: 404,
      body: { error: { type: 'not_found', message: 'not found' } },
    });
  });

  it('throws a 401 RecurlyApiError when the API key is empty (no request issued)', async () => {
    const client = new RecurlyClient({ ...baseConfig, apiKey: '' });
    await expect(client.request('GET', '/accounts')).rejects.toMatchObject({
      name: 'RecurlyApiError',
      status: 401,
    });
  });

  it('retries on 429 honoring Retry-After', async () => {
    nock('https://v3.recurly.com')
      .get('/accounts')
      .reply(429, '', { 'Retry-After': '0' })
      .get('/accounts')
      .reply(200, { object: 'list', data: [{ id: 1 }] });
    const client = new RecurlyClient(baseConfig);
    expect(await client.request('GET', '/accounts')).toEqual({ object: 'list', data: [{ id: 1 }] });
  });

  it('retries on 5xx up to maxRetries, then surfaces the final error', async () => {
    nock('https://v3.recurly.com')
      .get('/accounts')
      .reply(500, 'boom')
      .get('/accounts')
      .reply(500, 'boom')
      .get('/accounts')
      .reply(200, { object: 'list', data: [] });
    const ok = new RecurlyClient({ ...baseConfig, maxRetries: 2 });
    expect(await ok.request('GET', '/accounts')).toEqual({ object: 'list', data: [] });

    nock('https://v3.recurly.com')
      .get('/x')
      .times(3)
      .reply(503, { error: { message: 'down' } });
    const fail = new RecurlyClient({ ...baseConfig, maxRetries: 2 });
    await expect(fail.request('GET', '/x')).rejects.toMatchObject({ status: 503 });
  });

  it('wraps fetch/network failures as RecurlyNetworkError', async () => {
    nock('https://v3.recurly.com').get('/accounts').replyWithError('ECONNRESET');
    const client = new RecurlyClient({ ...baseConfig, maxRetries: 0 });
    await expect(client.request('GET', '/accounts')).rejects.toBeInstanceOf(RecurlyNetworkError);
  });

  it('returns null for an empty 204 response', async () => {
    nock('https://v3.recurly.com').get('/x').reply(204);
    const client = new RecurlyClient(baseConfig);
    expect(await client.request('GET', '/x')).toBeNull();
  });

  it('base64-wraps binary (PDF) responses', async () => {
    const pdf = Buffer.from('%PDF-1.4 hello');
    nock('https://v3.recurly.com')
      .get('/invoices/i1.pdf')
      .reply(200, pdf, { 'Content-Type': 'application/pdf' });
    const client = new RecurlyClient(baseConfig);
    const result = (await client.request('GET', '/invoices/i1.pdf')) as Record<string, string>;
    expect(result.object).toBe('binary_file');
    expect(result.content_type).toContain('application/pdf');
    expect(Buffer.from(result.data, 'base64').toString()).toBe('%PDF-1.4 hello');
  });

  it('strips case-variant Authorization / Host / Cookie from user headers', async () => {
    nock('https://v3.recurly.com', {
      reqheaders: { authorization: (v) => v === expectedAuth, 'x-ok': 'y' },
      badheaders: ['cookie'],
    })
      .get('/accounts')
      .reply(200, { ok: true });
    const client = new RecurlyClient(baseConfig);
    const result = await client.request('GET', '/accounts', {
      headers: { Authorization: 'attacker', Cookie: 'evil', Host: 'evil.example.com', 'X-Ok': 'y' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('refuses to follow a 3xx redirect and never resends auth to the target', async () => {
    nock('https://v3.recurly.com').get('/x').reply(302, '', {
      Location: 'https://evil.example.com/y',
    });
    const evil = nock('https://evil.example.com').get('/y').reply(200, { leaked: true });
    const client = new RecurlyClient({ ...baseConfig, maxRetries: 0 });
    await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(RecurlyNetworkError);
    expect(evil.isDone()).toBe(false);
  });

  it('pins accept/user-agent over user headers but allows accept-language override', async () => {
    nock('https://v3.recurly.com', {
      reqheaders: {
        accept: 'application/vnd.recurly.v2021-02-25',
        'user-agent': 'recurly-mcp',
        'accept-language': 'fr-FR',
        authorization: expectedAuth,
      },
    })
      .get('/accounts')
      .reply(200, { ok: true });
    const client = new RecurlyClient(baseConfig);
    const r = await client.request('GET', '/accounts', {
      headers: {
        accept: 'application/vnd.recurly.v2099-01-01',
        'user-agent': 'evil-agent',
        'accept-language': 'fr-FR',
      },
    });
    expect(r).toEqual({ ok: true });
  });

  it('drops a literal __proto__ key from upstream JSON (no pollution, not surfaced)', async () => {
    nock('https://v3.recurly.com')
      .get('/x')
      .reply(200, '{"object":"thing","__proto__":{"polluted":true}}', {
        'Content-Type': 'application/json',
      });
    const client = new RecurlyClient(baseConfig);
    const r = (await client.request('GET', '/x')) as Record<string, unknown>;
    expect(r.object).toBe('thing');
    expect(Object.prototype.hasOwnProperty.call(r, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects an oversized response via Content-Length', async () => {
    nock('https://v3.recurly.com')
      .get('/accounts')
      .reply(200, 'x', { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) });
    const client = new RecurlyClient({ ...baseConfig, maxRetries: 0 });
    await expect(client.request('GET', '/accounts')).rejects.toBeInstanceOf(RecurlyApiError);
  });

  describe('readBodyBytesWithLimit', () => {
    it('reads bodies under the cap', async () => {
      const out = await readBodyBytesWithLimit(new Response('hello'), 1024);
      expect(new TextDecoder().decode(out)).toBe('hello');
    });
    it('rejects bodies that exceed the cap', async () => {
      await expect(readBodyBytesWithLimit(new Response('a'.repeat(17)), 16)).rejects.toThrow(
        /exceeds 16 bytes/,
      );
    });
    it('handles a null (204) body', async () => {
      const out = await readBodyBytesWithLimit(new Response(null, { status: 204 }), 1024);
      expect(out.length).toBe(0);
    });
  });

  describe('parseRetryAfter', () => {
    it('parses integer seconds and clamps past dates to 0', () => {
      expect(parseRetryAfter('5')).toBe(5000);
      expect(parseRetryAfter('0')).toBe(0);
      const now = Date.parse('2026-05-23T12:00:00Z');
      expect(parseRetryAfter('Sat, 23 May 2026 12:00:10 GMT', now)).toBe(10_000);
      expect(parseRetryAfter('Sat, 23 May 2026 11:00:00 GMT', now)).toBe(0);
    });
    it('returns null for absent/empty/unparseable values', () => {
      expect(parseRetryAfter(null)).toBeNull();
      expect(parseRetryAfter('')).toBeNull();
      expect(parseRetryAfter('   ')).toBeNull();
      expect(parseRetryAfter('not-a-date')).toBeNull();
    });
    it('parses a huge future date that the client then clamps', () => {
      const huge = parseRetryAfter('Fri, 31 Dec 9999 23:59:59 GMT');
      expect(huge).not.toBeNull();
      expect(Math.min(MAX_RETRY_DELAY_MS, huge as number)).toBe(MAX_RETRY_DELAY_MS);
    });
  });

  describe('backoffMs', () => {
    afterEach(() => vi.restoreAllMocks());
    it('returns 50%-100% of 2^attempt * baseMs', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(backoffMs(0, 200)).toBe(100);
      expect(backoffMs(2, 200)).toBe(400);
      vi.spyOn(Math, 'random').mockReturnValue(1);
      expect(backoffMs(0, 200)).toBe(200);
    });
  });
});
