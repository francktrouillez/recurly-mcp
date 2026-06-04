import { describe, it, expect } from 'vitest';
import { enc, idParam, listParamsSchema, listQuery, fetchList } from '../../src/tools/shared.js';
import type { ToolContext } from '../../src/tools/types.js';

describe('enc', () => {
  it('URL-encodes path-unsafe characters', () => {
    expect(enc('code-a/b')).toBe('code-a%2Fb');
    expect(enc('plain')).toBe('plain');
    expect(enc('a b')).toBe('a%20b');
    expect(enc(123)).toBe('123');
  });
});

describe('idParam', () => {
  const schema = idParam('account_id');
  it('accepts opaque ids and prefixed codes', () => {
    expect(schema.parse('e28zov4fw0v2')).toBe('e28zov4fw0v2');
    expect(schema.parse('code-my_account')).toBe('code-my_account');
  });
  it('rejects blank, whitespace, CR/LF, and traversal segments', () => {
    expect(() => schema.parse('')).toThrow();
    expect(() => schema.parse('   ')).toThrow();
    expect(() => schema.parse('a\nb')).toThrow();
    expect(() => schema.parse('.')).toThrow();
    expect(() => schema.parse('..')).toThrow();
  });
});

describe('listParamsSchema', () => {
  it('bounds limit to 1..200 and accepts order/sort/cursor', () => {
    expect(() => listParamsSchema.parse({ limit: 0 })).toThrow();
    expect(() => listParamsSchema.parse({ limit: 201 })).toThrow();
    expect(listParamsSchema.parse({ limit: 200, order: 'asc', sort: 'updated_at' })).toMatchObject({
      limit: 200,
      order: 'asc',
      sort: 'updated_at',
    });
  });

  it('bounds ids (no commas, <=200) and string lengths to prevent amplification', () => {
    expect(() => listParamsSchema.parse({ ids: ['a,b'] })).toThrow();
    expect(() => listParamsSchema.parse({ ids: Array(201).fill('x') })).toThrow();
    expect(() => listParamsSchema.parse({ cursor: 'x'.repeat(2000) })).toThrow();
    expect(() => listParamsSchema.parse({ sort: 'x'.repeat(100) })).toThrow();
    expect(
      listParamsSchema.parse({ ids: ['a', 'b'], cursor: 'c1', sort: 'created_at' }),
    ).toMatchObject({ ids: ['a', 'b'], cursor: 'c1', sort: 'created_at' });
  });
});

describe('listQuery', () => {
  it('drops action, omitted path-params, and undefined; keeps the rest incl arrays', () => {
    const q = listQuery(
      { action: 'list', account_id: 'a', limit: 10, state: undefined, ids: ['x', 'y'] },
      ['account_id'],
    );
    expect(q).toEqual({ limit: 10, ids: ['x', 'y'] });
  });
});

describe('fetchList', () => {
  it('issues a GET and attaches the cursor hint', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const ctx = {
      client: {
        request: async (method: string, path: string, options: unknown) => {
          calls.push([method, path, options]);
          return { object: 'list', has_more: true, next: '/x?cursor=c2', data: [] };
        },
      },
      config: {},
    } as unknown as ToolContext;
    const r = (await fetchList(ctx, '/x', { action: 'list', limit: 5 })) as Record<string, unknown>;
    expect(calls[0]?.[0]).toBe('GET');
    expect(calls[0]?.[1]).toBe('/x');
    expect((calls[0]?.[2] as { query: unknown }).query).toEqual({ limit: 5 });
    expect(r._pagination).toEqual({ has_more: true, next_cursor: 'c2' });
  });
});
