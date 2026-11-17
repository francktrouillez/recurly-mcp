import { z } from 'zod';
import { enc, fetchList, idParam, standardListParams } from './shared.js';
import { activeStateFilter } from './filters.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .strictObject({ action: z.literal('list') })
    .extend(standardListParams)
    .extend(activeStateFilter),
  z.strictObject({ action: z.literal('get'), measured_unit_id: idParam('measured_unit_id') }),
]);

export const measuredUnitsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_measured_units',
  title: 'Recurly measured units',
  description:
    'Recurly measured units (read-only), used for metered/usage-based billing. Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/measured_units', parsed);
      case 'get':
        return ctx.client.request('GET', `/measured_units/${enc(parsed.measured_unit_id)}`);
    }
  },
};
