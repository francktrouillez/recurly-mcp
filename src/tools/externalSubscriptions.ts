import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const externalSubscriptionId = idParam('external_subscription_id');

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), external_subscription_id: externalSubscriptionId }),
  z
    .object({ action: z.literal('list_invoices'), external_subscription_id: externalSubscriptionId })
    .merge(listParamsSchema),
  z
    .object({
      action: z.literal('list_payment_phases'),
      external_subscription_id: externalSubscriptionId,
    })
    .merge(listParamsSchema),
  z.object({
    action: z.literal('get_payment_phase'),
    external_subscription_id: externalSubscriptionId,
    external_payment_phase_id: idParam('external_payment_phase_id'),
  }),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema),
]);

export const externalSubscriptionsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_external_subscriptions',
  description:
    'Recurly external subscriptions (read-only) — subscriptions managed in external app stores. Actions: list, get, list_invoices (external invoices for the subscription), list_payment_phases, get_payment_phase, list_for_account. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/external_subscriptions', parsed);
      case 'get':
        return ctx.client.request(
          'GET',
          `/external_subscriptions/${enc(parsed.external_subscription_id)}`,
        );
      case 'list_invoices':
        return fetchList(
          ctx,
          `/external_subscriptions/${enc(parsed.external_subscription_id)}/external_invoices`,
          parsed,
          ['external_subscription_id'],
        );
      case 'list_payment_phases':
        return fetchList(
          ctx,
          `/external_subscriptions/${enc(parsed.external_subscription_id)}/external_payment_phases`,
          parsed,
          ['external_subscription_id'],
        );
      case 'get_payment_phase':
        return ctx.client.request(
          'GET',
          `/external_subscriptions/${enc(parsed.external_subscription_id)}/external_payment_phases/${enc(parsed.external_payment_phase_id)}`,
        );
      case 'list_for_account':
        return fetchList(
          ctx,
          `/accounts/${enc(parsed.account_id)}/external_subscriptions`,
          parsed,
          ['account_id'],
        );
    }
  },
};
