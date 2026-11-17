import { z } from 'zod';
import { enc, fetchList, idParam, standardListParams } from './shared.js';
import { activeStateFilter } from './filters.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .strictObject({ action: z.literal('list') })
    .extend(standardListParams)
    .extend(activeStateFilter),
  z.strictObject({ action: z.literal('get'), add_on_id: idParam('add_on_id') }),
]);

export const addOnsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_add_ons',
  description:
    'Recurly add-ons (read-only), site-wide across all plans. Actions: list, get. For a specific plan’s add-ons use recurly_plans.list_add_ons. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/add_ons', parsed);
      case 'get':
        return ctx.client.request('GET', `/add_ons/${enc(parsed.add_on_id)}`);
    }
  },
};
