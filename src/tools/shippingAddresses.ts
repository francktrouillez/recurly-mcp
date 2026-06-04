import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const accountId = idParam('account_id');

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), account_id: accountId }).merge(listParamsSchema),
  z.object({
    action: z.literal('get'),
    account_id: accountId,
    shipping_address_id: idParam('shipping_address_id'),
  }),
]);

export const shippingAddressesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_shipping_addresses',
  description:
    "Recurly shipping addresses (read-only), scoped to an account. Actions: list (an account's shipping addresses), get (one by ID). Returns raw Recurly JSON; list adds a _pagination cursor hint.",
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/shipping_addresses`, parsed, [
          'account_id',
        ]);
      case 'get':
        return ctx.client.request(
          'GET',
          `/accounts/${enc(parsed.account_id)}/shipping_addresses/${enc(parsed.shipping_address_id)}`,
        );
    }
  },
};
