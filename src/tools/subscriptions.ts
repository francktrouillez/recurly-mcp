import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const subscriptionId = idParam('subscription_id');

const invoiceFilters = {
  state: z.string().optional().describe('Filter by invoice state.'),
  type: z.string().optional().describe('Filter by invoice type.'),
};

const lineItemFilters = {
  original: z.string().optional().describe('Filter by original line-item state.'),
  state: z.string().optional().describe('Filter by line-item state.'),
  type: z.string().optional().describe('Filter by line-item type.'),
};

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend({
      state: z.string().optional().describe('Filter by subscription state, e.g. active.'),
    }),
  z.object({ action: z.literal('get'), subscription_id: subscriptionId }),
  z.object({ action: z.literal('get_change'), subscription_id: subscriptionId }),
  z.object({ action: z.literal('get_preview_renewal'), subscription_id: subscriptionId }),
  z
    .object({ action: z.literal('list_invoices'), subscription_id: subscriptionId })
    .merge(listParamsSchema)
    .extend(invoiceFilters),
  z
    .object({ action: z.literal('list_line_items'), subscription_id: subscriptionId })
    .merge(listParamsSchema)
    .extend(lineItemFilters),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema)
    .extend({
      state: z.string().optional().describe('Filter by subscription state, e.g. active.'),
    }),
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
