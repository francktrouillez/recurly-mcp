import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const invoiceTemplateId = idParam('invoice_template_id');

const accountFilters = {
  email: z.string().optional().describe('Filter for accounts with this exact email address.'),
  subscriber: z
    .boolean()
    .optional()
    .describe('Filter for accounts with (true) or without (false) a subscription.'),
  past_due: z
    .string()
    .optional()
    .describe('Filter for accounts with an invoice in the past_due state ("true"/"false").'),
};

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), invoice_template_id: invoiceTemplateId }),
  z
    .object({ action: z.literal('list_accounts'), invoice_template_id: invoiceTemplateId })
    .merge(listParamsSchema)
    .extend(accountFilters),
]);

export const invoiceTemplatesTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_invoice_templates',
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
