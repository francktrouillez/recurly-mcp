import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const accountId = idParam('account_id');

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get'), account_id: accountId }),
  z.object({ action: z.literal('list'), account_id: accountId }).merge(listParamsSchema),
  z.object({
    action: z.literal('get_one'),
    account_id: accountId,
    billing_info_id: idParam('billing_info_id'),
  }),
]);

export const billingInfoTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_billing_info',
  description:
    "Recurly billing info (read-only), scoped to an account. Actions: get (the account's primary billing info), list (all billing infos on the account), get_one (a specific billing info by ID). Returns raw Recurly JSON; list adds a _pagination cursor hint.",
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'get':
        return ctx.client.request('GET', `/accounts/${enc(parsed.account_id)}/billing_info`);
      case 'list':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/billing_infos`, parsed, [
          'account_id',
        ]);
      case 'get_one':
        return ctx.client.request(
          'GET',
          `/accounts/${enc(parsed.account_id)}/billing_infos/${enc(parsed.billing_info_id)}`,
        );
    }
  },
};
