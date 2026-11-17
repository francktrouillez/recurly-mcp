import { z } from 'zod';
import { enc, fetchList, idParam, listParams } from './shared.js';
import type { ToolDefinition } from './types.js';

const externalProductId = idParam('external_product_id');

const inputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list') }).extend(listParams('sort')),
  z.strictObject({ action: z.literal('get'), external_product_id: externalProductId }),
  z
    .strictObject({ action: z.literal('list_references'), external_product_id: externalProductId })
    .extend(listParams('sort')),
  z.strictObject({
    action: z.literal('get_reference'),
    external_product_id: externalProductId,
    external_product_reference_id: idParam('external_product_reference_id'),
  }),
]);

export const externalProductsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_external_products',
  title: 'Recurly external products',
  description:
    'Recurly external products (read-only) — products from external app stores (Apple App Store, Google Play). Actions: list, get, list_references (external product references), get_reference. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/external_products', parsed);
      case 'get':
        return ctx.client.request('GET', `/external_products/${enc(parsed.external_product_id)}`);
      case 'list_references':
        return fetchList(
          ctx,
          `/external_products/${enc(parsed.external_product_id)}/external_product_references`,
          parsed,
          ['external_product_id'],
        );
      case 'get_reference':
        return ctx.client.request(
          'GET',
          `/external_products/${enc(parsed.external_product_id)}/external_product_references/${enc(parsed.external_product_reference_id)}`,
        );
    }
  },
};
