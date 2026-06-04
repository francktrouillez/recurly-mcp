import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend({
      account_type: z
        .string()
        .optional()
        .describe('Filter by general ledger account type, e.g. liability or revenue.'),
    }),
  z.object({
    action: z.literal('get'),
    general_ledger_account_id: idParam('general_ledger_account_id'),
  }),
]);

export const generalLedgerAccountsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_general_ledger_accounts',
  description:
    'Recurly general ledger accounts (read-only). Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/general_ledger_accounts', parsed);
      case 'get':
        return ctx.client.request(
          'GET',
          `/general_ledger_accounts/${enc(parsed.general_ledger_account_id)}`,
        );
    }
  },
};
