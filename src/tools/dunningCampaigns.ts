import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), dunning_campaign_id: idParam('dunning_campaign_id') }),
]);

export const dunningCampaignsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_dunning_campaigns',
  description:
    'Recurly dunning campaigns (read-only). Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/dunning_campaigns', parsed);
      case 'get':
        return ctx.client.request('GET', `/dunning_campaigns/${enc(parsed.dunning_campaign_id)}`);
    }
  },
};
