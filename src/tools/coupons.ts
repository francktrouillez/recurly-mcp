import { z } from 'zod';
import { enc, fetchList, idParam, listParamsSchema } from './shared.js';
import type { ToolDefinition } from './types.js';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).merge(listParamsSchema),
  z.object({ action: z.literal('get'), coupon_id: idParam('coupon_id') }),
  z
    .object({ action: z.literal('list_unique_coupon_codes'), coupon_id: idParam('coupon_id') })
    .merge(listParamsSchema)
    .extend({
      redeemed: z.string().optional().describe('Filter by redemption status ("true"/"false").'),
    }),
  z.object({
    action: z.literal('get_unique_coupon_code'),
    unique_coupon_code_id: idParam('unique_coupon_code_id'),
  }),
]);

export const couponsTool: ToolDefinition<typeof inputSchema> = {
  name: 'recurly_coupons',
  description:
    'Recurly coupons (read-only). Actions: list, get, list_unique_coupon_codes (the generated codes for a bulk coupon), get_unique_coupon_code (a single unique code by ID). coupon_id accepts a Recurly ID or `code-<your_code>`. Returns raw Recurly JSON; list actions add a _pagination cursor hint.',
  inputSchema,
  handler: async (ctx, input) => {
    const parsed = inputSchema.parse(input);
    switch (parsed.action) {
      case 'list':
        return fetchList(ctx, '/coupons', parsed);
      case 'get':
        return ctx.client.request('GET', `/coupons/${enc(parsed.coupon_id)}`);
      case 'list_unique_coupon_codes':
        return fetchList(ctx, `/coupons/${enc(parsed.coupon_id)}/unique_coupon_codes`, parsed, [
          'coupon_id',
        ]);
      case 'get_unique_coupon_code':
        return ctx.client.request(
          'GET',
          `/unique_coupon_codes/${enc(parsed.unique_coupon_code_id)}`,
        );
    }
  },
};
