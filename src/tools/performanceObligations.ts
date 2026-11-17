import { z } from 'zod';
import { enc, fetchList, idParam, listParams } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }).extend(listParams()),
  z.strictObject({
    action: z.literal('get'),
    performance_obligation_id: idParam('performance_obligation_id'),
  }),
]);

export const performanceObligationsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_performance_obligations',
  description:
    'Recurly performance obligations (read-only), used for revenue recognition. Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/performance_obligations', parsed);
      case 'get':
        return ctx.client.request(
          'GET',
          `/performance_obligations/${enc(parsed.performance_obligation_id)}`,
        );
    }
  },
};
