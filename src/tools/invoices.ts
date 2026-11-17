import { z } from 'zod';
import { enc, fetchList, idParam, listParams, standardListParams } from './shared.js';
import { invoiceFilters, lineItemFilters } from './filters.js';
import { preparePdfDir, writeInvoicePdf } from './invoicePdf.js';
import type { ToolDefinition } from './types.js';

const invoiceId = idParam('invoice_id');

// No `.default('file')`: MCP schemas are emitted in zod output mode, which would
// advertise a defaulted field as required. The handler applies the default.
const pdfDelivery = z
  .enum(['file', 'inline'])
  .optional()
  .describe(
    'How to return the PDF. "file" (default): write it under RECURLY_PDF_DIR and return its absolute path, size and sha256. "inline": return the bytes as a base64 binary_file wrapper — subject to RECURLY_MAX_OUTPUT_BYTES, so only small PDFs fit.',
  );

const inputSchema = z.discriminatedUnion('action', [
  z
    .strictObject({ action: z.literal('list') })
    .extend(standardListParams)
    .extend(invoiceFilters),
  z.strictObject({ action: z.literal('get'), invoice_id: invoiceId }),
  z.strictObject({ action: z.literal('get_pdf'), invoice_id: invoiceId, delivery: pdfDelivery }),
  z
    .strictObject({ action: z.literal('list_line_items'), invoice_id: invoiceId })
    .extend(standardListParams)
    .extend(lineItemFilters),
  z.strictObject({ action: z.literal('list_related'), invoice_id: invoiceId }).extend(listParams()),
  z
    .strictObject({ action: z.literal('list_for_account'), account_id: idParam('account_id') })
    .extend(standardListParams)
    .extend(invoiceFilters),
]);

export const invoicesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_invoices',
  title: 'Recurly invoices',
  description:
    'Recurly invoices (read-only). Actions: list, get, get_pdf (saves the PDF to a local file and returns its path; delivery="inline" returns base64 instead), list_line_items, list_related (related invoices), list_for_account. invoice_id accepts a Recurly ID or `number-<invoice_number>`. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/invoices', parsed);
      case 'get':
        return ctx.client.request('GET', `/invoices/${enc(parsed.invoice_id)}`);
      case 'get_pdf': {
        const pdfPath = `/invoices/${enc(parsed.invoice_id)}.pdf`;
        if (parsed.delivery === 'inline') return ctx.client.request('GET', pdfPath);
        const dir = await preparePdfDir(ctx.config.pdfDir);
        const pdf = await ctx.client.request('GET', pdfPath);
        return writeInvoicePdf(dir, parsed.invoice_id, pdf);
      }
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
