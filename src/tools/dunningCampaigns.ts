import { z } from 'zod';
import { enc, fetchList, idParam, listParams } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }).extend(listParams('sort')),
  z.strictObject({ action: z.literal('get'), dunning_campaign_id: idParam('dunning_campaign_id') }),
  // The spec lists no query params for this endpoint; `cursor` is still
  // accepted so later pages can be fetched through this action.
  z.strictObject({ action: z.literal('list_email_templates') }).extend(listParams()),
]);

export const dunningCampaignsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_dunning_campaigns',
  description:
    'Recurly dunning campaigns (read-only). Actions: list, get, list_email_templates (custom email templates assignable to dunning intervals; accepts only cursor). Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
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
