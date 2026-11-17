import { z } from 'zod';
import { enc, fetchList, idParam, optionalEnum, standardListParams } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .strictObject({ action: z.literal('list') })
    .extend(standardListParams)
    .extend({
      related_type: optionalEnum(
        ['account', 'item', 'plan', 'subscription', 'charge'],
        'Filter by related type.',
      ),
    }),
  z.strictObject({
    action: z.literal('get'),
    custom_field_definition_id: idParam('custom_field_definition_id'),
  }),
]);

export const customFieldDefinitionsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_custom_field_definitions',
  title: 'Recurly custom field definitions',
  description:
    'Recurly custom field definitions (read-only). Actions: list, get. Returns raw Recurly JSON; list adds a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/custom_field_definitions', parsed);
      case 'get':
        return ctx.client.request(
          'GET',
          `/custom_field_definitions/${enc(parsed.custom_field_definition_id)}`,
        );
    }
  },
};
