import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).extend(listParamsSchema.shape),
  z.object({ action: z.literal('get'), dunning_campaign_id: idParam('dunning_campaign_id') }),
  z.object({ action: z.literal('list_email_templates') }),
]);

export const dunningCampaignsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_dunning_campaigns',
  description:
    'Recurly dunning campaigns (read-only). Actions: list, get, list_email_templates (custom email templates assignable to dunning intervals; no params; to page, call recurly_request on /dunning_campaigns/email_templates with query.cursor = _pagination.next_cursor). Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/dunning_campaigns', parsed);
      case 'get':
        return ctx.client.request('GET', `/dunning_campaigns/${enc(parsed.dunning_campaign_id)}`);
      case 'list_email_templates':
        return fetchList(ctx, '/dunning_campaigns/email_templates', parsed);
    }
  },
};
