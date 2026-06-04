import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const planId = idParam('plan_id');

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend({ state: z.string().optional().describe('Filter by state, e.g. active.') }),
  z.object({ action: z.literal('get'), plan_id: planId }),
  z
    .object({ action: z.literal('list_add_ons'), plan_id: planId })
    .merge(listParamsSchema)
    .extend({ state: z.string().optional().describe('Filter by state.') }),
  z.object({ action: z.literal('get_add_on'), plan_id: planId, add_on_id: idParam('add_on_id') }),
]);

export const plansTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_plans',
  description:
    'Recurly plans (read-only). Actions: list, get, list_add_ons (a plan’s add-ons), get_add_on (a plan add-on by ID). plan_id and add_on_id accept a Recurly ID or `code-<your_code>`. For site-wide add-ons across all plans use recurly_add_ons. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/plans', parsed);
      case 'get':
        return ctx.client.request('GET', `/plans/${enc(parsed.plan_id)}`);
      case 'list_add_ons':
        return fetchList(ctx, `/plans/${enc(parsed.plan_id)}/add_ons`, parsed, ['plan_id']);
      case 'get_add_on':
        return ctx.client.request(
          'GET',
          `/plans/${enc(parsed.plan_id)}/add_ons/${enc(parsed.add_on_id)}`,
        );
    }
  },
};
