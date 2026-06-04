import { accountsTool } from './accounts.js';
import { addOnsTool } from './addOns.js';
import { billingInfoTool } from './billingInfo.js';
import { businessEntitiesTool } from './businessEntities.js';
import { couponRedemptionsTool } from './couponRedemptions.js';
import { couponsTool } from './coupons.js';
import { creditPaymentsTool } from './creditPayments.js';
import { customFieldDefinitionsTool } from './customFieldDefinitions.js';
import { dunningCampaignsTool } from './dunningCampaigns.js';
import { exportTool } from './exports.js';
import { externalAccountsTool } from './externalAccounts.js';
import { externalInvoicesTool } from './externalInvoices.js';
import { externalProductsTool } from './externalProducts.js';
import { externalSubscriptionsTool } from './externalSubscriptions.js';
import { generalLedgerAccountsTool } from './generalLedgerAccounts.js';
import { giftCardsTool } from './giftCards.js';
import { invoiceTemplatesTool } from './invoiceTemplates.js';
import { invoicesTool } from './invoices.js';
import { itemsTool } from './items.js';
import { lineItemsTool } from './lineItems.js';
import { measuredUnitsTool } from './measuredUnits.js';
import { performanceObligationsTool } from './performanceObligations.js';
import { plansTool } from './plans.js';
import { priceSegmentsTool } from './priceSegments.js';
import { requestTool } from './request.js';
import { shippingAddressesTool } from './shippingAddresses.js';
import { shippingMethodsTool } from './shippingMethods.js';
import { sitesTool } from './sites.js';
import { subscriptionsTool } from './subscriptions.js';
import { transactionsTool } from './transactions.js';
import { usageTool } from './usage.js';
import type { ToolDefinition } from './types.js';

// One resource-grouped tool per Recurly resource, plus the generic
// `recurly_request` escape hatch. All actions are read-only (GET).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: ToolDefinition<any>[] = [
  sitesTool,
  accountsTool,
  billingInfoTool,
  shippingAddressesTool,
  couponsTool,
  couponRedemptionsTool,
  creditPaymentsTool,
  invoicesTool,
  lineItemsTool,
  subscriptionsTool,
  transactionsTool,
  customFieldDefinitionsTool,
  itemsTool,
  measuredUnitsTool,
  plansTool,
  addOnsTool,
  shippingMethodsTool,
  usageTool,
  exportTool,
  dunningCampaignsTool,
  invoiceTemplatesTool,
  externalProductsTool,
  externalSubscriptionsTool,
  externalInvoicesTool,
  externalAccountsTool,
  generalLedgerAccountsTool,
  performanceObligationsTool,
  priceSegmentsTool,
  businessEntitiesTool,
  giftCardsTool,
  requestTool,
];
