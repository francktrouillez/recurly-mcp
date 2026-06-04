import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), credit_payment_id: idParam('credit_payment_id') }),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema),
]);

export const creditPaymentsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_credit_payments',
  description:
    'Recurly credit payments (read-only). Actions: list (site-wide), get (one by ID), list_for_account. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/credit_payments', parsed);
      case 'get':
        return ctx.client.request('GET', `/credit_payments/${enc(parsed.credit_payment_id)}`);
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/credit_payments`, parsed, [
          'account_id',
        ]);
    }
  },
};
