import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/server.js';

// The SDK stores handlers on a private `_requestHandlers` map keyed by method.
// If the SDK ever removes this internal, switch to an in-memory transport pair.
function getHandler(
  server: unknown,
  method: string,
): (req: unknown, extra: unknown) => Promise<unknown> {
  const map = (
    server as {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
    }
  )._requestHandlers;
  const handler = map.get(method);
  if (!handler) throw new Error(`no handler for ${method}`);
  return handler;
}

const EXPECTED_TOOL_COUNT = 31;

describe('MCP server integration', () => {
  beforeEach(() => nock.cleanAll());

  it('lists all 31 unique recurly_* tools including the escape hatch', async () => {
    const server = await createServer({ RECURLY_API_KEY: 'k' });
    const handler = getHandler(server, ListToolsRequestSchema.shape.method.value);
    const result = (await handler({ method: 'tools/list', params: {} }, {})) as {
      tools: { name: string }[];
    };
    const names = result.tools.map((t) => t.name);
    expect(names).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(new Set(names).size).toBe(EXPECTED_TOOL_COUNT);
    expect(names).toContain('recurly_accounts');
    expect(names).toContain('recurly_subscriptions');
    expect(names).toContain('recurly_request');
    expect(names.every((n) => n.startsWith('recurly_'))).toBe(true);
  });

  it('every tool inputSchema satisfies MCP / Claude constraints', async () => {
    const server = await createServer({ RECURLY_API_KEY: 'k' });
    const handler = getHandler(server, ListToolsRequestSchema.shape.method.value);
    const result = (await handler({ method: 'tools/list', params: {} }, {})) as {
      tools: { name: string; inputSchema: Record<string, unknown> }[];
    };
    for (const t of result.tools) {
      expect(t.inputSchema.type, `${t.name} missing type:"object"`).toBe('object');
      expect(t.inputSchema.anyOf, `${t.name} has top-level anyOf`).toBeUndefined();
      expect(t.inputSchema.oneOf, `${t.name} has top-level oneOf`).toBeUndefined();
      expect(t.inputSchema.allOf, `${t.name} has top-level allOf`).toBeUndefined();
    }
  });

  it('exposes `action` as a top-level enum for discriminated tools', async () => {
    const server = await createServer({ RECURLY_API_KEY: 'k' });
    const handler = getHandler(server, ListToolsRequestSchema.shape.method.value);
    const result = (await handler({ method: 'tools/list', params: {} }, {})) as {
      tools: { name: string; inputSchema: Record<string, unknown> }[];
    };
    const accounts = result.tools.find((t) => t.name === 'recurly_accounts')!;
    const props = accounts.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.action.enum).toEqual(
      expect.arrayContaining(['list', 'get', 'get_balance', 'list_notes', 'list_entitlements']),
    );
  });

  it('routes a tool call to its handler and adds the pagination hint', async () => {
    nock('https://v3.recurly.com')
      .get('/sites')
      .reply(200, { object: 'list', has_more: false, next: null, data: [{ id: 's1' }] });
    const server = await createServer({ RECURLY_API_KEY: 'k' });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler(
      { method: 'tools/call', params: { name: 'recurly_sites', arguments: { action: 'list' } } },
      {},
    )) as { content: { text: string }[] };
    expect(result.content[0]?.text).toContain('"object"');
    expect(result.content[0]?.text).toContain('_pagination');
  });

  it('returns isError on an unknown tool', async () => {
    const server = await createServer({ RECURLY_API_KEY: 'k' });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler(
      { method: 'tools/call', params: { name: 'nope', arguments: {} } },
      {},
    )) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('truncates an oversized list result and emits compact JSON', async () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, blob: 'x'.repeat(500) }));
    nock('https://v3.recurly.com')
      .get('/sites')
      .reply(200, { object: 'list', has_more: false, next: null, data });
    const server = await createServer({ RECURLY_API_KEY: 'k', RECURLY_MAX_OUTPUT_BYTES: '4000' });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler(
      { method: 'tools/call', params: { name: 'recurly_sites', arguments: { action: 'list' } } },
      {},
    )) as { content: { text: string }[] };
    const text = result.content[0]!.text;
    expect(text).not.toContain('\n'); // compact
    expect(text).toContain('_truncated');
    const parsed = JSON.parse(text);
    expect(parsed.data.length).toBeLessThan(50);
    expect(parsed._truncated.omitted_items).toBeGreaterThan(0);
  });

  it('caps the error text returned to the client (no huge upstream error body forwarded)', async () => {
    const huge = 'y'.repeat(50_000);
    nock('https://v3.recurly.com')
      .get('/accounts/x')
      .reply(400, { error: { message: huge } });
    const server = await createServer({ RECURLY_API_KEY: 'k', RECURLY_MAX_OUTPUT_BYTES: '1000' });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler(
      {
        method: 'tools/call',
        params: { name: 'recurly_accounts', arguments: { action: 'get', account_id: 'x' } },
      },
      {},
    )) as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text.length).toBeLessThanOrEqual(1100);
    expect(result.content[0]!.text).not.toContain('y'.repeat(2000));
  });

  it('returns isError when the handler throws (Recurly 404)', async () => {
    nock('https://v3.recurly.com')
      .get('/accounts/nope')
      .reply(404, { error: { message: 'no' } });
    const server = await createServer({ RECURLY_API_KEY: 'k' });
    const handler = getHandler(server, CallToolRequestSchema.shape.method.value);
    const result = (await handler(
      {
        method: 'tools/call',
        params: { name: 'recurly_accounts', arguments: { action: 'get', account_id: 'nope' } },
      },
      {},
    )) as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/404/);
  });

  describe('startup warnings', () => {
    afterEach(() => vi.restoreAllMocks());

    it('warns to stderr when RECURLY_API_KEY is unset', async () => {
      const writes: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      await createServer({});
      expect(writes.some((s) => /RECURLY_API_KEY/.test(s))).toBe(true);
    });

    it('does not warn when RECURLY_API_KEY is set', async () => {
      const writes: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
      await createServer({ RECURLY_API_KEY: 'k' });
      expect(writes.length).toBe(0);
    });
  });
});
