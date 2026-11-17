import { z } from 'zod';
import { enc, fetchList, idParam, listParams, standardListParams } from './shared.js';
import { accountFilters } from './filters.js';
import type { ToolDefinition } from './types.js';

const invoiceTemplateId = idParam('invoice_template_id');

const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }).extend(listParams('sort')),
  z.strictObject({ action: z.literal('get'), invoice_template_id: invoiceTemplateId }),
  z
    .strictObject({ action: z.literal('list_accounts'), invoice_template_id: invoiceTemplateId })
    .extend(standardListParams)
    .extend(accountFilters),
]);

export const invoiceTemplatesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_invoice_templates',
  title: 'Recurly invoice templates',
  description:
    'Recurly invoice templates (read-only). Actions: list, get, list_accounts (accounts assigned to a template). Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/invoice_templates', parsed);
      case 'get':
        return ctx.client.request('GET', `/invoice_templates/${enc(parsed.invoice_template_id)}`);
      case 'list_accounts':
        return fetchList(
          ctx,
          `/invoice_templates/${enc(parsed.invoice_template_id)}/accounts`,
          parsed,
          ['invoice_template_id'],
        );
    }
  },
};
