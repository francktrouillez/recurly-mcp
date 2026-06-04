import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
      subscription_id: idParam('subscription_id'),
      add_on_id: idParam('add_on_id'),
    })
    .merge(listParamsSchema)
    .extend({
      billing_status: z
        .string()
        .optional()
        .describe('Filter by billing status: unbilled, billed, or all.'),
    }),
  z.object({ action: z.literal('get'), usage_id: idParam('usage_id') }),
]);

export const usageTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_usage',
  description:
    'Recurly usage records (read-only) for a metered subscription add-on. Actions: list (requires subscription_id and add_on_id), get (one usage record by ID). Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(
          ctx,
          `/subscriptions/${enc(parsed.subscription_id)}/add_ons/${enc(parsed.add_on_id)}/usage`,
          parsed,
          ['subscription_id', 'add_on_id'],
        );
      case 'get':
        return ctx.client.request('GET', `/usage/${enc(parsed.usage_id)}`);
    }
  },
};
