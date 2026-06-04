import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend({
      related_type: z
        .string()
        .optional()
        .describe('Filter by related type, e.g. account or item.'),
    }),
  z.object({
    action: z.literal('get'),
    custom_field_definition_id: idParam('custom_field_definition_id'),
  }),
]);

export const customFieldDefinitionsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_custom_field_definitions',
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
