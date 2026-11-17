import { z } from 'zod';
import { enc, fetchList, idParam, standardListParams } from './shared.js';
import { activeStateFilter } from './filters.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .strictObject({ action: z.literal('list') })
    .extend(standardListParams)
    .extend(activeStateFilter),
  z.strictObject({ action: z.literal('get'), item_id: idParam('item_id') }),
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
