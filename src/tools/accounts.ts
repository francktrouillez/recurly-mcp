import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const accountId = idParam('account_id');

const accountFilters = {
  email: z.string().optional().describe('Filter for accounts with this exact email address.'),
  subscriber: z
    .boolean()
    .optional()
    .describe('Filter for accounts with (true) or without (false) a subscription.'),
  past_due: z
    .string()
    .optional()
    .describe('Filter for accounts with an invoice in the past_due state ("true"/"false").'),
};

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend(accountFilters),
  z.object({ action: z.literal('get'), account_id: accountId }),
  z.object({ action: z.literal('get_balance'), account_id: accountId }),
  z.object({ action: z.literal('get_acquisition'), account_id: accountId }),
  z.object({ action: z.literal('list_acquisitions') }).merge(listParamsSchema),
  z
    .object({ action: z.literal('list_child_accounts'), account_id: accountId })
    .merge(listParamsSchema)
    .extend(accountFilters),
  z.object({ action: z.literal('list_notes'), account_id: accountId }).merge(listParamsSchema),
  z.object({
    action: z.literal('get_note'),
    account_id: accountId,
    account_note_id: idParam('account_note_id'),
  }),
  z
    .object({ action: z.literal('list_entitlements'), account_id: accountId })
    .merge(listParamsSchema)
    .extend({ state: z.string().optional().describe('Filter by state, e.g. subscribed.') }),
]);

export const accountsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_accounts',
  description:
    'Recurly accounts (read-only). Actions: list, get, get_balance, get_acquisition (acquisition cost for an account), list_acquisitions (site-wide acquisition data), list_child_accounts, list_notes, get_note, list_entitlements. account_id accepts a Recurly ID or `code-<your_code>`. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/accounts', parsed);
      case 'get':
        return ctx.client.request('GET', `/accounts/${enc(parsed.account_id)}`);
      case 'get_balance':
        return ctx.client.request('GET', `/accounts/${enc(parsed.account_id)}/balance`);
      case 'get_acquisition':
        return ctx.client.request('GET', `/accounts/${enc(parsed.account_id)}/acquisition`);
      case 'list_acquisitions':
        return fetchList(ctx, '/acquisitions', parsed);
      case 'list_child_accounts':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/accounts`, parsed, [
          'account_id',
        ]);
      case 'list_notes':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/notes`, parsed, ['account_id']);
      case 'get_note':
        return ctx.client.request(
          'GET',
          `/accounts/${enc(parsed.account_id)}/notes/${enc(parsed.account_note_id)}`,
        );
      case 'list_entitlements':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/entitlements`, parsed, [
          'account_id',
        ]);
    }
  },
};
