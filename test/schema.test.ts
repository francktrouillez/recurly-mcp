import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toMcpInputSchema } from '../src/server.js';
import { requestTool } from '../src/tools/request.js';

// Union flattening and the `action` enum are covered against every real tool
// in integration.test.ts; these pin the zod 4 conversion details.
type Props = Record<string, Record<string, unknown>>;

describe('toMcpInputSchema (zod 4 → MCP JSON Schema)', () => {
  it('omits $schema and keeps only the action required across all branches', () => {
    const schema = z.discriminatedUnion('action', [
      z.object({ action: z.literal('list'), limit: z.number().optional() }),
      z.object({ action: z.literal('get'), id: z.string() }),
    ]);
    const json = toMcpInputSchema(schema);
    expect(json).not.toHaveProperty('$schema');
    expect(json.required).toEqual(['action']);
  });

  it('notes which actions accept a property not shared by every action', () => {
    const limit = z.number().describe('Page size.');
    const schema = z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('list'), limit }),
      z.strictObject({ action: z.literal('list_more'), limit, id: z.string() }),
      z.strictObject({ action: z.literal('get'), id: z.string() }),
    ]);
    const props = toMcpInputSchema(schema).properties as Props;
    expect(props.limit.description).toBe('Page size. Only for actions: list, list_more.');
    expect(props.id.description).toBe('Only for actions: list_more, get.');
    expect(props.action).not.toHaveProperty('description');
  });

  it('tags each distinct description of a shared property with its actions', () => {
    const schema = z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('list'), state: z.string().describe('Sub state.') }),
      z.strictObject({
        action: z.literal('list_invoices'),
        state: z.string().describe('Inv state.'),
      }),
      z.strictObject({ action: z.literal('list_mine'), state: z.string().describe('Sub state.') }),
    ]);
    const props = toMcpInputSchema(schema).properties as Props;
    expect(props.state.description).toBe('list, list_mine: Sub state. list_invoices: Inv state.');
  });

  it('advertises the union of differing per-action enums and tags each with its values', () => {
    const schema = z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('list'), state: z.enum(['active', 'live']) }),
      z.strictObject({ action: z.literal('list_invoices'), state: z.enum(['paid', 'active']) }),
    ]);
    const state = (toMcpInputSchema(schema).properties as Props).state;
    expect(state.enum).toEqual(['active', 'live', 'paid']);
    expect(state.description).toBe(
      'list: (no description) One of: active, live. list_invoices: (no description) One of: paid, active.',
    );
  });

  it('drops the enum when another action accepts any value for the property', () => {
    const schema = z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('list'), state: z.enum(['active']) }),
      z.strictObject({ action: z.literal('list_more'), state: z.string() }),
    ]);
    expect((toMcpInputSchema(schema).properties as Props).state).not.toHaveProperty('enum');
  });

  it('refuses to merge a property whose type differs across actions', () => {
    const schema = z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('list'), subscriber: z.boolean() }),
      z.strictObject({ action: z.literal('list_more'), subscriber: z.enum(['true']) }),
    ]);
    expect(() => toMcpInputSchema(schema)).toThrow(/"subscriber" has incompatible schemas/);
  });

  it('closes nested plain objects but leaves catchall objects open', () => {
    const json = toMcpInputSchema(
      z.object({
        filter: z.object({ state: z.string() }),
        extra: z.object({}).catchall(z.string()),
      }),
    );
    const props = json.properties as Props;
    expect(json.additionalProperties).toBe(false);
    expect(props.filter.additionalProperties).toBe(false);
    expect(props.extra.additionalProperties).toEqual({ type: 'string' });
  });

  it('emits only standard keywords for the recurly_request path', () => {
    const json = toMcpInputSchema(requestTool.inputSchema);
    const path = (json.properties as Props).path;
    expect(path).not.toHaveProperty('format');
    expect(path.pattern).toBe('^\\/');
  });
});
