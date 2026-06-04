import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import type { ToolContext } from '../../src/tools/types.js';

interface RecordedCall {
  method: string;
  path: string;
  options: { query?: Record<string, unknown>; headers?: Record<string, string> };
}

function stub(): { ctx: ToolContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const ctx = {
    client: {
      request: async (method: string, path: string, options: RecordedCall['options'] = {}) => {
        calls.push({ method, path, options });
        return { object: 'list', has_more: false, next: null, data: [] };
      },
    },
    config: {},
  } as unknown as ToolContext;
  return { ctx, calls };
}

function tool(name: string) {
  const t = allTools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

// Every read-only operation, mapped to the GET path it must produce. This is
// the feature-parity contract: one row per Recurly v2021-02-25 GET endpoint.
const cases: Array<[string, Record<string, unknown>, string]> = [
  // sites (2)
  ['recurly_sites', { action: 'list' }, '/sites'],
  ['recurly_sites', { action: 'get', site_id: 'subdomain-acme' }, '/sites/subdomain-acme'],
  // accounts (9)
  ['recurly_accounts', { action: 'list' }, '/accounts'],
  ['recurly_accounts', { action: 'get', account_id: 'code-a' }, '/accounts/code-a'],
  ['recurly_accounts', { action: 'get_balance', account_id: 'a' }, '/accounts/a/balance'],
  ['recurly_accounts', { action: 'get_acquisition', account_id: 'a' }, '/accounts/a/acquisition'],
  ['recurly_accounts', { action: 'list_acquisitions' }, '/acquisitions'],
  ['recurly_accounts', { action: 'list_child_accounts', account_id: 'a' }, '/accounts/a/accounts'],
  ['recurly_accounts', { action: 'list_notes', account_id: 'a' }, '/accounts/a/notes'],
  ['recurly_accounts', { action: 'get_note', account_id: 'a', account_note_id: 'n1' }, '/accounts/a/notes/n1'],
  ['recurly_accounts', { action: 'list_entitlements', account_id: 'a' }, '/accounts/a/entitlements'],
  // billing_info (3)
  ['recurly_billing_info', { action: 'get', account_id: 'a' }, '/accounts/a/billing_info'],
  ['recurly_billing_info', { action: 'list', account_id: 'a' }, '/accounts/a/billing_infos'],
  ['recurly_billing_info', { action: 'get_one', account_id: 'a', billing_info_id: 'b1' }, '/accounts/a/billing_infos/b1'],
  // shipping_addresses (2)
  ['recurly_shipping_addresses', { action: 'list', account_id: 'a' }, '/accounts/a/shipping_addresses'],
  ['recurly_shipping_addresses', { action: 'get', account_id: 'a', shipping_address_id: 's1' }, '/accounts/a/shipping_addresses/s1'],
  // coupons (4)
  ['recurly_coupons', { action: 'list' }, '/coupons'],
  ['recurly_coupons', { action: 'get', coupon_id: 'code-c' }, '/coupons/code-c'],
  ['recurly_coupons', { action: 'list_unique_coupon_codes', coupon_id: 'c1' }, '/coupons/c1/unique_coupon_codes'],
  ['recurly_coupons', { action: 'get_unique_coupon_code', unique_coupon_code_id: 'u1' }, '/unique_coupon_codes/u1'],
  // coupon_redemptions (6)
  ['recurly_coupon_redemptions', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/coupon_redemptions'],
  ['recurly_coupon_redemptions', { action: 'list_active_for_account', account_id: 'a' }, '/accounts/a/coupon_redemptions/active'],
  ['recurly_coupon_redemptions', { action: 'get_for_account', account_id: 'a', coupon_redemption_id: 'r1' }, '/accounts/a/coupon_redemptions/r1'],
  ['recurly_coupon_redemptions', { action: 'list_for_invoice', invoice_id: 'i1' }, '/invoices/i1/coupon_redemptions'],
  ['recurly_coupon_redemptions', { action: 'list_for_subscription', subscription_id: 'sub1' }, '/subscriptions/sub1/coupon_redemptions'],
  ['recurly_coupon_redemptions', { action: 'get_for_subscription', subscription_id: 'sub1', coupon_redemption_id: 'r1' }, '/subscriptions/sub1/coupon_redemptions/r1'],
  // credit_payments (3)
  ['recurly_credit_payments', { action: 'list' }, '/credit_payments'],
  ['recurly_credit_payments', { action: 'get', credit_payment_id: 'cp1' }, '/credit_payments/cp1'],
  ['recurly_credit_payments', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/credit_payments'],
  // invoices (6)
  ['recurly_invoices', { action: 'list' }, '/invoices'],
  ['recurly_invoices', { action: 'get', invoice_id: 'i1' }, '/invoices/i1'],
  ['recurly_invoices', { action: 'get_pdf', invoice_id: 'i1' }, '/invoices/i1.pdf'],
  ['recurly_invoices', { action: 'list_line_items', invoice_id: 'i1' }, '/invoices/i1/line_items'],
  ['recurly_invoices', { action: 'list_related', invoice_id: 'i1' }, '/invoices/i1/related_invoices'],
  ['recurly_invoices', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/invoices'],
  // line_items (3)
  ['recurly_line_items', { action: 'list' }, '/line_items'],
  ['recurly_line_items', { action: 'get', line_item_id: 'l1' }, '/line_items/l1'],
  ['recurly_line_items', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/line_items'],
  // subscriptions (7)
  ['recurly_subscriptions', { action: 'list' }, '/subscriptions'],
  ['recurly_subscriptions', { action: 'get', subscription_id: 'sub1' }, '/subscriptions/sub1'],
  ['recurly_subscriptions', { action: 'get_change', subscription_id: 'sub1' }, '/subscriptions/sub1/change'],
  ['recurly_subscriptions', { action: 'get_preview_renewal', subscription_id: 'sub1' }, '/subscriptions/sub1/preview_renewal'],
  ['recurly_subscriptions', { action: 'list_invoices', subscription_id: 'sub1' }, '/subscriptions/sub1/invoices'],
  ['recurly_subscriptions', { action: 'list_line_items', subscription_id: 'sub1' }, '/subscriptions/sub1/line_items'],
  ['recurly_subscriptions', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/subscriptions'],
  // transactions (3)
  ['recurly_transactions', { action: 'list' }, '/transactions'],
  ['recurly_transactions', { action: 'get', transaction_id: 't1' }, '/transactions/t1'],
  ['recurly_transactions', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/transactions'],
  // custom_field_definitions (2)
  ['recurly_custom_field_definitions', { action: 'list' }, '/custom_field_definitions'],
  ['recurly_custom_field_definitions', { action: 'get', custom_field_definition_id: 'cf1' }, '/custom_field_definitions/cf1'],
  // items (2)
  ['recurly_items', { action: 'list' }, '/items'],
  ['recurly_items', { action: 'get', item_id: 'code-it' }, '/items/code-it'],
  // measured_units (2)
  ['recurly_measured_units', { action: 'list' }, '/measured_units'],
  ['recurly_measured_units', { action: 'get', measured_unit_id: 'm1' }, '/measured_units/m1'],
  // plans (4)
  ['recurly_plans', { action: 'list' }, '/plans'],
  ['recurly_plans', { action: 'get', plan_id: 'code-p' }, '/plans/code-p'],
  ['recurly_plans', { action: 'list_add_ons', plan_id: 'code-p' }, '/plans/code-p/add_ons'],
  ['recurly_plans', { action: 'get_add_on', plan_id: 'code-p', add_on_id: 'ao1' }, '/plans/code-p/add_ons/ao1'],
  // add_ons (2)
  ['recurly_add_ons', { action: 'list' }, '/add_ons'],
  ['recurly_add_ons', { action: 'get', add_on_id: 'ao1' }, '/add_ons/ao1'],
  // shipping_methods (2)
  ['recurly_shipping_methods', { action: 'list' }, '/shipping_methods'],
  ['recurly_shipping_methods', { action: 'get', shipping_method_id: 'code-sm' }, '/shipping_methods/code-sm'],
  // usage (2)
  ['recurly_usage', { action: 'list', subscription_id: 'sub1', add_on_id: 'ao1' }, '/subscriptions/sub1/add_ons/ao1/usage'],
  ['recurly_usage', { action: 'get', usage_id: 'us1' }, '/usage/us1'],
  // export (2)
  ['recurly_export', { action: 'get_dates' }, '/export_dates'],
  ['recurly_export', { action: 'get_files', export_date: '2021-06-01' }, '/export_dates/2021-06-01/export_files'],
  // dunning_campaigns (2)
  ['recurly_dunning_campaigns', { action: 'list' }, '/dunning_campaigns'],
  ['recurly_dunning_campaigns', { action: 'get', dunning_campaign_id: 'd1' }, '/dunning_campaigns/d1'],
  // invoice_templates (3)
  ['recurly_invoice_templates', { action: 'list' }, '/invoice_templates'],
  ['recurly_invoice_templates', { action: 'get', invoice_template_id: 'it1' }, '/invoice_templates/it1'],
  ['recurly_invoice_templates', { action: 'list_accounts', invoice_template_id: 'it1' }, '/invoice_templates/it1/accounts'],
  // external_products (4)
  ['recurly_external_products', { action: 'list' }, '/external_products'],
  ['recurly_external_products', { action: 'get', external_product_id: 'ep1' }, '/external_products/ep1'],
  ['recurly_external_products', { action: 'list_references', external_product_id: 'ep1' }, '/external_products/ep1/external_product_references'],
  ['recurly_external_products', { action: 'get_reference', external_product_id: 'ep1', external_product_reference_id: 'epr1' }, '/external_products/ep1/external_product_references/epr1'],
  // external_subscriptions (6)
  ['recurly_external_subscriptions', { action: 'list' }, '/external_subscriptions'],
  ['recurly_external_subscriptions', { action: 'get', external_subscription_id: 'es1' }, '/external_subscriptions/es1'],
  ['recurly_external_subscriptions', { action: 'list_invoices', external_subscription_id: 'es1' }, '/external_subscriptions/es1/external_invoices'],
  ['recurly_external_subscriptions', { action: 'list_payment_phases', external_subscription_id: 'es1' }, '/external_subscriptions/es1/external_payment_phases'],
  ['recurly_external_subscriptions', { action: 'get_payment_phase', external_subscription_id: 'es1', external_payment_phase_id: 'pp1' }, '/external_subscriptions/es1/external_payment_phases/pp1'],
  ['recurly_external_subscriptions', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/external_subscriptions'],
  // external_invoices (3)
  ['recurly_external_invoices', { action: 'list' }, '/external_invoices'],
  ['recurly_external_invoices', { action: 'get', external_invoice_id: 'ei1' }, '/external_invoices/ei1'],
  ['recurly_external_invoices', { action: 'list_for_account', account_id: 'a' }, '/accounts/a/external_invoices'],
  // external_accounts (2)
  ['recurly_external_accounts', { action: 'list', account_id: 'a' }, '/accounts/a/external_accounts'],
  ['recurly_external_accounts', { action: 'get', account_id: 'a', external_account_id: 'ea1' }, '/accounts/a/external_accounts/ea1'],
  // general_ledger_accounts (2)
  ['recurly_general_ledger_accounts', { action: 'list' }, '/general_ledger_accounts'],
  ['recurly_general_ledger_accounts', { action: 'get', general_ledger_account_id: 'gl1' }, '/general_ledger_accounts/gl1'],
  // performance_obligations (2)
  ['recurly_performance_obligations', { action: 'list' }, '/performance_obligations'],
  ['recurly_performance_obligations', { action: 'get', performance_obligation_id: 'po1' }, '/performance_obligations/po1'],
  // price_segments (2)
  ['recurly_price_segments', { action: 'list' }, '/price_segments'],
  ['recurly_price_segments', { action: 'get', price_segment_id: 'ps1' }, '/price_segments/ps1'],
  // business_entities (3)
  ['recurly_business_entities', { action: 'list' }, '/business_entities'],
  ['recurly_business_entities', { action: 'get', business_entity_id: 'code-be' }, '/business_entities/code-be'],
  ['recurly_business_entities', { action: 'list_invoices', business_entity_id: 'be1' }, '/business_entities/be1/invoices'],
  // gift_cards (2)
  ['recurly_gift_cards', { action: 'list' }, '/gift_cards'],
  ['recurly_gift_cards', { action: 'get', gift_card_id: 'g1' }, '/gift_cards/g1'],
];

describe('read-only action → GET path mapping (feature-parity contract)', () => {
  it('covers exactly the 97 documented v2021-02-25 read operations', () => {
    expect(cases.length).toBe(97);
  });

  for (const [name, args, path] of cases) {
    it(`${name}: ${String(args.action)} -> GET ${path}`, async () => {
      const { ctx, calls } = stub();
      await tool(name).handler(ctx, args);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
      expect(calls[0]?.path).toBe(path);
    });
  }

  it('URL-encodes path parameters to prevent segment injection', async () => {
    const { ctx, calls } = stub();
    await tool('recurly_accounts').handler(ctx, { action: 'get', account_id: 'code-a/b' });
    expect(calls[0]?.path).toBe('/accounts/code-a%2Fb');
  });

  it('routes list filters to the query string but keeps path params out of it', async () => {
    const { ctx, calls } = stub();
    await tool('recurly_subscriptions').handler(ctx, {
      action: 'list_for_account',
      account_id: 'a',
      state: 'active',
      limit: 5,
    });
    expect(calls[0]?.path).toBe('/accounts/a/subscriptions');
    expect(calls[0]?.options.query).toEqual({ state: 'active', limit: 5 });
  });

  it('recurly_request issues a raw GET to an arbitrary path', async () => {
    const { ctx, calls } = stub();
    await tool('recurly_request').handler(ctx, { path: '/accounts', query: { limit: 3 } });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.path).toBe('/accounts');
    expect(calls[0]?.options.query).toEqual({ limit: 3 });
  });

  it('recurly_request rejects path traversal and non-/ paths', async () => {
    const { ctx } = stub();
    await expect(
      tool('recurly_request').handler(ctx, { path: '/accounts/../../admin' }),
    ).rejects.toThrow();
    await expect(tool('recurly_request').handler(ctx, { path: 'accounts' })).rejects.toThrow();
  });
});
