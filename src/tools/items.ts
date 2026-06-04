import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend({ state: z.string().optional().describe('Filter by state, e.g. active or inactive.') }),
  z.object({ action: z.literal('get'), item_id: idParam('item_id') }),
]);

export const itemsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_items',
  description:
    'Recurly catalog items (read-only). Actions: list, get. item_id accepts a Recurly ID or `code-<your_code>`. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/items', parsed);
      case 'get':
        return ctx.client.request('GET', `/items/${enc(parsed.item_id)}`);
    }
  },
};
