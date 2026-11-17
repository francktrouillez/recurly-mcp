import { z } from 'zod';
import { optionalEnum } from './shared.js';

// Resource filters shared by several list endpoints. Enum values are exactly
// what the Recurly v2021-02-25 OpenAPI spec allows for each query param, and
// they differ per resource: a subscription `state` is not an invoice `state`.
// The spec types its boolean-like filters (`past_due`, `original`, `success`,
// `redeemed`) as strings, so they take the string "true" (or "false" where
// documented), matching how they are sent in the query string.

// Sites, items, plans, add-ons, measured units, coupon redemptions.
export const activeStateFilter = {
  state: optionalEnum(['active', 'inactive'], 'Filter by state.'),
};

export const subscriptionStateFilter = {
  state: optionalEnum(
    ['active', 'canceled', 'expired', 'future', 'in_trial', 'live'],
    'Filter by subscription state. in_trial: currently in a trial; live: active, canceled, future, or in trial.',
  ),
};

export const accountFilters = {
  email: z.string().optional().describe('Filter for accounts with this exact email address.'),
  subscriber: z
    .boolean()
    .optional()
    .describe('Filter for accounts with (true) or without (false) a subscription.'),
  past_due: optionalEnum(['true'], 'Filter for accounts with an invoice in the past_due state.'),
};

export const invoiceFilters = {
  state: optionalEnum(
    ['pending', 'processing', 'past_due', 'paid', 'failed', 'open', 'closed', 'voided'],
    'Filter by invoice state. Omit for all states.',
  ),
  type: optionalEnum(
    ['charge', 'credit', 'legacy', 'non-legacy'],
    'Filter by invoice type. non-legacy: charge and credit invoices.',
  ),
};

export const lineItemFilters = {
  original: optionalEnum(['true'], 'Filter for original line items.'),
  state: optionalEnum(['invoiced', 'pending'], 'Filter by line-item state.'),
  type: optionalEnum(['charge', 'credit'], 'Filter by line-item type.'),
};

export const transactionFilters = {
  type: optionalEnum(
    ['authorization', 'capture', 'payment', 'purchase', 'refund', 'verify'],
    'Filter by transaction type. payment: both purchase and capture transactions.',
  ),
  success: optionalEnum(['true'], 'Filter for successful transactions.'),
};
