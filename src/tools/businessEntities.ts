import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const businessEntityId = idParam('business_entity_id');

const invoiceFilters = {
  state: z.string().optional().describe('Filter by invoice state, e.g. open, paid, past_due.'),
  type: z.string().optional().describe('Filter by invoice type, e.g. charge, credit.'),
};

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), business_entity_id: businessEntityId }),
  z
    .object({ action: z.literal('list_invoices'), business_entity_id: businessEntityId })
    .merge(listParamsSchema)
    .extend(invoiceFilters),
]);

export const businessEntitiesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_business_entities',
  description:
    'Recurly business entities (read-only). Actions: list, get, list_invoices (invoices for a business entity). business_entity_id accepts a Recurly ID or `code-<your_code>`. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/business_entities', parsed);
      case 'get':
        return ctx.client.request('GET', `/business_entities/${enc(parsed.business_entity_id)}`);
      case 'list_invoices':
        return fetchList(
          ctx,
          `/business_entities/${enc(parsed.business_entity_id)}/invoices`,
          parsed,
          ['business_entity_id'],
        );
    }
  },
};
