import { z } from 'zod';
import { enc, idParam } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get_dates') }),
  z.object({ action: z.literal('get_files'), export_date: idParam('export_date') }),
]);

export const exportTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_export',
  description:
    'Recurly automated exports (read-only). Actions: get_dates (the dates that have available export files), get_files (the export files available for a given date; export_date is an ISO date like 2021-06-01). Returns raw Recurly JSON.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'get_dates':
        return ctx.client.request('GET', '/export_dates');
      case 'get_files':
        return ctx.client.request('GET', `/export_dates/${enc(parsed.export_date)}/export_files`);
    }
  },
};
