import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), external_invoice_id: idParam('external_invoice_id') }),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema),
]);

export const externalInvoicesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_external_invoices',
  description:
    'Recurly external invoices (read-only) — invoices from external app stores. Actions: list (site-wide), get (one by ID), list_for_account. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/external_invoices', parsed);
      case 'get':
        return ctx.client.request('GET', `/external_invoices/${enc(parsed.external_invoice_id)}`);
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/external_invoices`, parsed, [
          'account_id',
        ]);
    }
  },
};
