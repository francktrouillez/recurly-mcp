import { z } from 'zod';
import { enc, fetchList, idParam, listParams } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }).extend(listParams('limit', 'order', 'ids')),
  z.strictObject({ action: z.literal('get'), price_segment_id: idParam('price_segment_id') }),
]);

export const priceSegmentsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_price_segments',
  description:
    'Recurly price segments (read-only). Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/price_segments', parsed);
      case 'get':
        return ctx.client.request('GET', `/price_segments/${enc(parsed.price_segment_id)}`);
    }
  },
};
