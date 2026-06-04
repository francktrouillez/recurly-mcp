import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const accountId = idParam('account_id');

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), account_id: accountId }).merge(listParamsSchema),
  z.object({
    action: z.literal('get'),
    account_id: accountId,
    external_account_id: idParam('external_account_id'),
  }),
]);

export const externalAccountsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_external_accounts',
  description:
    "Recurly external accounts (read-only), scoped to an account — links to a customer's identity in an external app store. Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.",
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/external_accounts`, parsed, [
          'account_id',
        ]);
      case 'get':
        return ctx.client.request(
          'GET',
          `/accounts/${enc(parsed.account_id)}/external_accounts/${enc(parsed.external_account_id)}`,
        );
    }
  },
};
