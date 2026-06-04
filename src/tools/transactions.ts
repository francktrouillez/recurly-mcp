import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const transactionFilters = {
  type: z.string().optional().describe('Filter by transaction type, e.g. authorization, purchase.'),
  success: z.string().optional().describe('Filter by success ("true"/"false").'),
};

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend(transactionFilters),
  z.object({ action: z.literal('get'), transaction_id: idParam('transaction_id') }),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema)
    .extend(transactionFilters),
]);

export const transactionsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_transactions',
  description:
    'Recurly transactions (read-only). Actions: list (site-wide), get (one by ID or `uuid-<uuid>`), list_for_account. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/transactions', parsed);
      case 'get':
        return ctx.client.request('GET', `/transactions/${enc(parsed.transaction_id)}`);
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/transactions`, parsed, [
          'account_id',
        ]);
    }
  },
};
