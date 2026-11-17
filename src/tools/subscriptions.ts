import { z } from 'zod';
import { enc, fetchList, idParam, standardListParams } from './shared.js';
import { invoiceFilters, lineItemFilters, subscriptionStateFilter } from './filters.js';
import type { ToolDefinition } from './types.js';

const subscriptionId = idParam('subscription_id');

const inputSchema = z.discriminatedUnion('action', [
  z
    .strictObject({ action: z.literal('list') })
    .extend(standardListParams)
    .extend(subscriptionStateFilter),
  z.strictObject({ action: z.literal('get'), subscription_id: subscriptionId }),
  z.strictObject({ action: z.literal('get_change'), subscription_id: subscriptionId }),
  z.strictObject({ action: z.literal('get_preview_renewal'), subscription_id: subscriptionId }),
  z
    .strictObject({ action: z.literal('list_invoices'), subscription_id: subscriptionId })
    .extend(standardListParams)
    .extend(invoiceFilters),
  z
    .strictObject({ action: z.literal('list_line_items'), subscription_id: subscriptionId })
    .extend(standardListParams)
    .extend(lineItemFilters),
  z
    .strictObject({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .extend(standardListParams)
    .extend(subscriptionStateFilter),
]);

export const subscriptionsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_subscriptions',
  description:
    'Recurly subscriptions (read-only). Actions: list, get, get_change (the pending change, if any), get_preview_renewal (a preview of the next renewal invoice), list_invoices, list_line_items, list_for_account. subscription_id accepts a Recurly ID or `uuid-<uuid>`. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/subscriptions', parsed);
      case 'get':
        return ctx.client.request('GET', `/subscriptions/${enc(parsed.subscription_id)}`);
      case 'get_change':
        return ctx.client.request('GET', `/subscriptions/${enc(parsed.subscription_id)}/change`);
      case 'get_preview_renewal':
        return ctx.client.request(
          'GET',
          `/subscriptions/${enc(parsed.subscription_id)}/preview_renewal`,
        );
      case 'list_invoices':
        return fetchList(ctx, `/subscriptions/${enc(parsed.subscription_id)}/invoices`, parsed, [
          'subscription_id',
        ]);
      case 'list_line_items':
        return fetchList(ctx, `/subscriptions/${enc(parsed.subscription_id)}/line_items`, parsed, [
          'subscription_id',
        ]);
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/subscriptions`, parsed, [
          'account_id',
        ]);
    }
  },
};
