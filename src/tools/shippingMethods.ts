import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), shipping_method_id: idParam('shipping_method_id') }),
]);

export const shippingMethodsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_shipping_methods',
  description:
    'Recurly shipping methods (read-only). Actions: list, get. shipping_method_id accepts a Recurly ID or `code-<your_code>`. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/shipping_methods', parsed);
      case 'get':
        return ctx.client.request('GET', `/shipping_methods/${enc(parsed.shipping_method_id)}`);
    }
  },
};
