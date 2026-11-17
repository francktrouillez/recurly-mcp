import { z } from 'zod';
import { enc, fetchList, idParam, listParams } from './shared.js';
import type { ToolDefinition } from './types.js';

// Both list endpoints document the same query params.
const creditPaymentListParams = listParams('limit', 'order', 'sort', 'begin_time', 'end_time');

const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }).extend(creditPaymentListParams),
  z.strictObject({ action: z.literal('get'), credit_payment_id: idParam('credit_payment_id') }),
  z
    .strictObject({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .extend(creditPaymentListParams),
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
