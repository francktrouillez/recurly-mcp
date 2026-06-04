# Changelog

All notable changes to `recurly-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-03

Initial release. A **read-only** MCP server with feature parity on every `GET`
endpoint of the Recurly v2021-02-25 API — 30 resource-grouped tools covering all
97 read operations, plus a generic `recurly_request` escape hatch.

### Added

- **30 resource tools** (`recurly_sites`, `recurly_accounts`, `recurly_billing_info`,
  `recurly_shipping_addresses`, `recurly_coupons`, `recurly_coupon_redemptions`,
  `recurly_credit_payments`, `recurly_invoices`, `recurly_line_items`,
  `recurly_subscriptions`, `recurly_transactions`, `recurly_custom_field_definitions`,
  `recurly_items`, `recurly_measured_units`, `recurly_plans`, `recurly_add_ons`,
  `recurly_shipping_methods`, `recurly_usage`, `recurly_export`,
  `recurly_dunning_campaigns`, `recurly_invoice_templates`, `recurly_external_products`,
  `recurly_external_subscriptions`, `recurly_external_invoices`, `recurly_external_accounts`,
  `recurly_general_ledger_accounts`, `recurly_performance_obligations`,
  `recurly_price_segments`, `recurly_business_entities`, `recurly_gift_cards`) — each a
  discriminated union of read-only actions returning the raw Recurly JSON payload.
- `recurly_request` — escape hatch for any Recurly API path. Read-only: only `GET`
  is supported, with path-traversal and header-injection guards.
- HTTP client: HTTP Basic auth (private API key), `Accept: application/vnd.recurly.<version>`,
  comma-separated array query params, retries on 429 (honoring `Retry-After`, including the
  HTTP-date form) and 5xx with equal-jitter exponential backoff, a 25 MB response cap, and
  base64 wrapping of binary responses (invoice PDFs).
- Read-only by construction: the client's only HTTP method is `GET`. No mutating code path.
- Cursor pagination: `limit`/`order`/`sort`/`cursor`/`ids`/`begin_time`/`end_time` plus
  per-resource filters; responses gain a `_pagination` hint with `next_cursor`.
- US/EU region selection (`RECURLY_REGION`), host override (`RECURLY_HOST`), configurable
  timeout and retries; startup warning when `RECURLY_API_KEY` is unset.
- `npm run validate` — spawns the built server and validates every tool's `inputSchema`
  against MCP/Claude constraints (top-level `type: "object"`, no top-level
  `anyOf`/`oneOf`/`allOf`).
- CI on Node 20 + 22: `npm audit --audit-level=high`, lint, typecheck, test (154 tests), build, validate.

### Security

- Path parameters are URL-encoded and reject `.`/`..` segments; the `recurly_request`
  path rejects `..` traversal (raw or percent-encoded) and requires a leading `/`.
- User-supplied headers are lowercased and the reserved set
  (`authorization`/`host`/`cookie`) is stripped before the canonical Basic auth header
  is attached; header values with CR/LF are rejected.
- `RECURLY_HOST` must be a parseable `http:`/`https:` URL; warns on `http:`.
- A server-supplied `Retry-After` is capped at 60 s to prevent a stall holding the API key.

### Notes

This is an **unofficial** project, not affiliated with or endorsed by Recurly. It mirrors
the structure of [airbrake-mcp](https://github.com/francktrouillez/airbrake-mcp).

[Unreleased]: https://github.com/francktrouillez/recurly-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/francktrouillez/recurly-mcp/releases/tag/v0.1.0
