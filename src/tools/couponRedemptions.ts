import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const accountId = idParam('account_id');
const couponRedemptionId = idParam('coupon_redemption_id');

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list_for_account'), account_id: accountId })
    .merge(listParamsSchema)
    .extend({ state: z.string().optional().describe('Filter by state, e.g. active or inactive.') }),
  z.object({ action: z.literal('list_active_for_account'), account_id: accountId }),
  z.object({
    action: z.literal('get_for_account'),
    account_id: accountId,
    coupon_redemption_id: couponRedemptionId,
  }),
  z
    .object({ action: z.literal('list_for_invoice'), invoice_id: idParam('invoice_id') })
    .merge(listParamsSchema),
  z
    .object({
      action: z.literal('list_for_subscription'),
      subscription_id: idParam('subscription_id'),
    })
    .merge(listParamsSchema),
  z.object({
    action: z.literal('get_for_subscription'),
    subscription_id: idParam('subscription_id'),
    coupon_redemption_id: couponRedemptionId,
  }),
]);

export const couponRedemptionsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_coupon_redemptions',
  description:
    'Recurly coupon redemptions (read-only), viewed from their parent resource. Actions: list_for_account, list_active_for_account (the currently-active redemption(s) on an account), get_for_account, list_for_invoice, list_for_subscription, get_for_subscription. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/coupon_redemptions`, parsed, [
          'account_id',
        ]);
      case 'list_active_for_account':
        return ctx.client.request(
          'GET',
          `/accounts/${enc(parsed.account_id)}/coupon_redemptions/active`,
        );
      case 'get_for_account':
        return ctx.client.request(
          'GET',
          `/accounts/${enc(parsed.account_id)}/coupon_redemptions/${enc(parsed.coupon_redemption_id)}`,
        );
      case 'list_for_invoice':
        return fetchList(ctx, `/invoices/${enc(parsed.invoice_id)}/coupon_redemptions`, parsed, [
          'invoice_id',
        ]);
      case 'list_for_subscription':
        return fetchList(
          ctx,
          `/subscriptions/${enc(parsed.subscription_id)}/coupon_redemptions`,
          parsed,
          ['subscription_id'],
        );
      case 'get_for_subscription':
        return ctx.client.request(
          'GET',
          `/subscriptions/${enc(parsed.subscription_id)}/coupon_redemptions/${enc(parsed.coupon_redemption_id)}`,
        );
    }
  },
};
