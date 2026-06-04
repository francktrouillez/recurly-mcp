import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const lineItemFilters = {
  original: z.string().optional().describe('Filter by original line-item state.'),
  state: z.string().optional().describe('Filter by line-item state.'),
  type: z.string().optional().describe('Filter by line-item type, e.g. charge, credit.'),
};

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend(lineItemFilters),
  z.object({ action: z.literal('get'), line_item_id: idParam('line_item_id') }),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema)
    .extend(lineItemFilters),
]);

export const lineItemsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_line_items',
  description:
    'Recurly line items (read-only). Actions: list (site-wide), get (one by ID), list_for_account. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/line_items', parsed);
      case 'get':
        return ctx.client.request('GET', `/line_items/${enc(parsed.line_item_id)}`);
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/line_items`, parsed, [
          'account_id',
        ]);
    }
  },
};
