import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const invoiceId = idParam('invoice_id');

const invoiceFilters = {
  state: z.string().optional().describe('Filter by invoice state, e.g. open, paid, past_due.'),
  type: z.string().optional().describe('Filter by invoice type, e.g. charge, credit.'),
};

const lineItemFilters = {
  original: z.string().optional().describe('Filter by original line-item state.'),
  state: z.string().optional().describe('Filter by line-item state.'),
  type: z.string().optional().describe('Filter by line-item type, e.g. charge, credit.'),
};

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('list') })
    .merge(listParamsSchema)
    .extend(invoiceFilters),
  z.object({ action: z.literal('get'), invoice_id: invoiceId }),
  z.object({ action: z.literal('get_pdf'), invoice_id: invoiceId }),
  z
    .object({ action: z.literal('list_line_items'), invoice_id: invoiceId })
    .merge(listParamsSchema)
    .extend(lineItemFilters),
  z.object({ action: z.literal('list_related'), invoice_id: invoiceId }).merge(listParamsSchema),
  z
    .object({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .merge(listParamsSchema)
    .extend(invoiceFilters),
]);

export const invoicesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_invoices',
  description:
    'Recurly invoices (read-only). Actions: list, get, get_pdf (returns the PDF as a base64 binary_file wrapper), list_line_items, list_related (related invoices), list_for_account. invoice_id accepts a Recurly ID or `number-<invoice_number>`. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/invoices', parsed);
      case 'get':
        return ctx.client.request('GET', `/invoices/${enc(parsed.invoice_id)}`);
      case 'get_pdf':
        return ctx.client.request('GET', `/invoices/${enc(parsed.invoice_id)}.pdf`);
      case 'list_line_items':
        return fetchList(ctx, `/invoices/${enc(parsed.invoice_id)}/line_items`, parsed, [
          'invoice_id',
        ]);
      case 'list_related':
        return fetchList(ctx, `/invoices/${enc(parsed.invoice_id)}/related_invoices`, parsed, [
          'invoice_id',
        ]);
      case 'list_for_account':
        return fetchList(ctx, `/accounts/${enc(parsed.account_id)}/invoices`, parsed, [
          'account_id',
        ]);
    }
  },
};
