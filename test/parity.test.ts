import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parse } from 'yaml';
import {
  compareParity,
  deriveToolActions,
  errorCount,
  extractSpecEndpoints,
  formatReport,
  parityTools,
  type ToolAction,
} from '../scripts/parity.js';
import type { ToolDefinition } from '../src/tools/types.js';

const fixtureSpec = parse(`
openapi: 3.0.0
paths:
  /widgets:
    get:
      operationId: list_widgets
      parameters:
        - $ref: '#/components/parameters/limit'
        - { name: color, in: query }
        - { name: Accept-Language, in: header }
    post:
      operationId: create_widget
  /widgets/{widget_id}:
    parameters:
      - { name: widget_id, in: path, required: true }
      - { name: expand, in: query }
    get:
      operationId: get_widget
      parameters:
        - { name: expand, in: query, description: op-level override }
  /widgets/{widget_id}/parts:
    get:
      operationId: list_widget_parts
      parameters:
        - $ref: '#/components/parameters/limit'
  /gadgets:
    get:
      operationId: list_gadgets
  /legacy:
    get:
      operationId: list_legacy
      deprecated: true
components:
  parameters:
    limit: { name: limit, in: query }
`);

describe('extractSpecEndpoints', () => {
  it('lists GET operations with resolved, merged query params', () => {
    expect(extractSpecEndpoints(fixtureSpec)).toEqual([
      { path: '/gadgets', operationId: 'list_gadgets', deprecated: false, query: [] },
      { path: '/legacy', operationId: 'list_legacy', deprecated: true, query: [] },
      {
        path: '/widgets',
        operationId: 'list_widgets',
        deprecated: false,
        query: ['color', 'limit'],
      },
      {
        path: '/widgets/{widget_id}',
        operationId: 'get_widget',
        deprecated: false,
        query: ['expand'],
      },
      {
        path: '/widgets/{widget_id}/parts',
        operationId: 'list_widget_parts',
        deprecated: false,
        query: ['limit'],
      },
    ]);
  });

  it('rejects documents without paths and unresolvable refs', () => {
    expect(() => extractSpecEndpoints({ openapi: '3.0.0' })).toThrow(/missing top-level `paths`/);
    expect(() =>
      extractSpecEndpoints({ paths: { '/x': { get: { parameters: [{ $ref: '#/nope/x' }] } } } }),
    ).toThrow(/unresolvable \$ref: #\/nope\/x/);
    expect(() =>
      extractSpecEndpoints({
        paths: { '/x': { get: { parameters: [{ $ref: 'other.yaml#/x' }] } } },
      }),
    ).toThrow(/unsupported external \$ref/);
    expect(() =>
      extractSpecEndpoints({ paths: { '/x': { get: { parameters: [{ in: 'query' }] } } } }),
    ).toThrow(/malformed parameter/);
    expect(() =>
      extractSpecEndpoints({
        paths: { '/x': { get: { parameters: [{ $ref: '#/a' }] } } },
        a: { $ref: '#/a' },
      }),
    ).toThrow(/\$ref chain too deep/);
  });

  it('follows chained $refs, including $ref path items', () => {
    const spec = {
      paths: { '/x': { $ref: '#/components/pathItems/x' } },
      components: {
        pathItems: { x: { get: { parameters: [{ $ref: '#/components/parameters/alias' }] } } },
        parameters: {
          alias: { $ref: '#/components/parameters/sort' },
          sort: { name: 'sort', in: 'query' },
        },
      },
    };
    expect(extractSpecEndpoints(spec)).toEqual([
      { path: '/x', operationId: undefined, deprecated: false, query: ['sort'] },
    ]);
  });
});

const action = (path: string, name: string, params: string[]): ToolAction => ({
  tool: 'recurly_widgets',
  action: name,
  path,
  params,
});

describe('compareParity', () => {
  const specEndpoints = extractSpecEndpoints(fixtureSpec);

  it('reports missing endpoints/params as errors and extras as warnings', () => {
    const report = compareParity(specEndpoints, [
      action('/widgets', 'list', ['cursor', 'limit', 'sort']),
      // Placeholder names need not match the spec's.
      action('/widgets/{id}', 'get', []),
      action('/widgets/{widget_id}/parts', 'list_parts', ['cursor', 'limit']),
      action('/sprockets', 'list_sprockets', []),
    ]);

    expect(report.specEndpointCount).toBe(5);
    expect(report.missingEndpoints.map((e) => e.path)).toEqual(['/gadgets']);
    expect(report.deprecatedMissingEndpoints.map((e) => e.path)).toEqual(['/legacy']);
    expect(report.missingParams).toEqual([
      { path: '/widgets', actions: ['recurly_widgets.list'], params: ['color'] },
      { path: '/widgets/{widget_id}', actions: ['recurly_widgets.get'], params: ['expand'] },
    ]);
    // `cursor` is always allowed; `sort` is ours only.
    expect(report.extraParams).toEqual([
      { path: '/widgets', action: 'recurly_widgets.list', params: ['sort'] },
    ]);
    expect(report.unknownEndpoints.map((a) => a.path)).toEqual(['/sprockets']);

    expect(errorCount(report, false)).toBe(3);
    expect(errorCount(report, true)).toBe(6);
  });

  it('accepts a spec param when any action on the endpoint covers it', () => {
    const report = compareParity(
      specEndpoints.filter((e) => e.path === '/widgets'),
      [action('/widgets', 'list', ['limit']), action('/widgets', 'list_by_color', ['color'])],
    );
    expect(report.missingParams).toEqual([]);
    expect(errorCount(report, true)).toBe(0);
  });

  it('formats a readable report whose severity follows --strict', () => {
    const report = compareParity(
      specEndpoints.filter((e) => e.path === '/widgets'),
      [action('/widgets', 'list', ['color', 'limit', 'sort'])],
      ['recurly_broken.get: handler rejected sample input: boom'],
    );
    const lenient = formatReport(report, false);
    expect(lenient).toContain('Spec GET endpoints: 1, covered by our tools: 1');
    expect(lenient).toContain('ERROR could not derive tool endpoints (1):');
    expect(lenient).toContain('WARN params our actions accept that the spec does not list (1):');
    expect(lenient).toContain('  - /widgets [recurly_widgets.list]: sort');
    expect(lenient).toContain('FAIL: 1 parity error(s).');
    expect(formatReport(report, true)).toContain('FAIL: 2 parity error(s).');

    const clean = compareParity(report.missingEndpoints, []);
    expect(formatReport(clean, false)).toContain('OK: no parity errors.');
  });
});

describe('deriveToolActions', () => {
  it('maps every real tool action to a GET path template and the query it sends', async () => {
    const { actions, errors } = await deriveToolActions(parityTools);
    expect(errors).toEqual([]);
    expect(actions.map((a) => a.tool)).not.toContain('recurly_request');
    expect(actions.find((a) => a.tool === 'recurly_accounts' && a.action === 'get')).toEqual({
      tool: 'recurly_accounts',
      action: 'get',
      path: '/accounts/{account_id}',
      params: [],
    });
    // Non-string filters (limit: int, order: enum, subscriber: boolean) are sampled too.
    const list = actions.find((a) => a.tool === 'recurly_accounts' && a.action === 'list');
    expect(list?.params).toEqual(expect.arrayContaining(['ids', 'limit', 'order', 'subscriber']));
    const usage = actions.find((a) => a.tool === 'recurly_usage' && a.action === 'list');
    expect(usage?.path).toBe('/subscriptions/{subscription_id}/add_ons/{add_on_id}/usage');
    expect(usage?.params).toContain('billing_status');
    expect(usage?.params).not.toContain('subscription_id');
  });

  it('reads params from the recorded query, including required non-path keys', async () => {
    const inputSchema = z.object({
      q: z.string(),
      limit: z.number().int().min(1).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    });
    const tool: ToolDefinition<typeof inputSchema> = {
      name: 'recurly_search',
      description: 'fixture',
      inputSchema,
      handler: async (ctx, input) => ctx.client.request('GET', '/search', { query: input }),
    };
    expect(await deriveToolActions([tool])).toEqual({
      actions: [
        {
          tool: 'recurly_search',
          action: '(single)',
          path: '/search',
          params: ['limit', 'order', 'q'],
        },
      ],
      errors: [],
    });
  });

  it('collects derivation failures instead of throwing', async () => {
    const inputSchema = z.discriminatedUnion('action', [
      z.object({ action: z.literal('get') }),
      z.object({ action: z.literal('twice') }),
      z.object({ action: z.literal('drop'), state: z.string().optional() }),
      z.object({ action: z.literal('dated'), at: z.date() }),
      z.object({ action: z.literal('leak'), id: z.string() }),
    ]);
    const tool: ToolDefinition<typeof inputSchema> = {
      name: 'recurly_broken',
      description: 'fixture',
      inputSchema,
      handler: async (ctx, input) => {
        const parsed = inputSchema.parse(input);
        if (parsed.action === 'get') throw new Error('boom');
        if (parsed.action === 'leak') {
          return ctx.client.request('GET', `/a/${parsed.id}`, { query: { id: parsed.id } });
        }
        await ctx.client.request('GET', '/a');
        if (parsed.action === 'twice') await ctx.client.request('GET', '/b');
      },
    };
    const { actions, errors } = await deriveToolActions([tool]);
    expect(actions).toEqual([]);
    expect(errors).toEqual([
      'recurly_broken.get: handler rejected sample input: boom',
      'recurly_broken.twice: expected exactly one request, got 2',
      'recurly_broken.drop: accepts but never sends: state',
      'recurly_broken.dated: no sample value satisfies the schema for "at"',
      'recurly_broken.leak: sends path keys in the query too: id',
    ]);
  });
});
