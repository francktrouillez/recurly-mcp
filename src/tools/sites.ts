import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend({ state: z.string().optional().describe('Filter by state, e.g. active or inactive.') }),
  z.object({ action: z.literal('get'), site_id: idParam('site_id') }),
]);

export const sitesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_sites',
  description:
    'Recurly sites (read-only). Actions: list (all sites your key can access), get (a single site by ID or `subdomain-<name>`). Returns the raw Recurly JSON payload — no data is removed; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/sites', parsed);
      case 'get':
        return ctx.client.request('GET', `/sites/${enc(parsed.site_id)}`);
    }
  },
};
