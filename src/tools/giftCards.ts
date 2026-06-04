import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), gift_card_id: idParam('gift_card_id') }),
]);

export const giftCardsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_gift_cards',
  description:
    'Recurly gift cards (read-only). Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/gift_cards', parsed);
      case 'get':
        return ctx.client.request('GET', `/gift_cards/${enc(parsed.gift_card_id)}`);
    }
  },
};
