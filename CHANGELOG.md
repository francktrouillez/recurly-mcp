# Changelog

All notable changes to `recurly-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-11-18

This release contains breaking changes. Read **Changed** before upgrading.

### Added

- `recurly_dunning_campaigns` `list_email_templates` for
  `GET /dunning_campaigns/email_templates`, added to Recurly's spec after 0.1.0. The tools
  again cover every one of the 98 read endpoints of the current v2021-02-25 spec (#4).
- Every tool now has a human-readable `title` and MCP tool annotations: `readOnlyHint: true`,
  `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`. Clients can show
  the tools as safe or auto-approve them (#5).
- `recurly_invoices` `get_pdf` takes a `delivery` option (`file` or `inline`). A new
  `RECURLY_PDF_DIR` setting chooses where PDFs are saved; it defaults to
  `<os tmpdir>/recurly-mcp` (#7).
- `npm run parity` and a weekly `spec-parity` workflow compare the tools with Recurly's
  published OpenAPI spec and fail when they drift (#9).

### Changed

- **Breaking:** Node.js 22 or later is now required (Node 20 reached end of life on
  2026-04-30). CI runs on Node 22 and 24. Dev toolchain: TypeScript 6, ESLint 10,
  Vitest 5 (#6).
- **Breaking:** `get_pdf` now saves the PDF to a local file by default and returns
  `{ object, content_type, byte_length, sha256, path }`. Files are written with mode `0600`
  in a `0700` directory. Pass `delivery: "inline"` for the previous base64 payload, which is
  still subject to `RECURLY_MAX_OUTPUT_BYTES` (#7).
- **Breaking:** each list action now accepts only the query params Recurly documents for its
  endpoint, plus `cursor`. Every action rejects unknown keys with a readable error naming the
  key; they used to be dropped silently (#8).
- **Breaking:** filters with a fixed set of values (`state`, `type`, `sort`, `past_due`,
  `original`, `success`, `redeemed`, `billing_status`, `account_type`, `related_type`) are now
  enums of the values the spec allows for that endpoint. `past_due`, `original` and `success`
  accept only `"true"` (#10).

### Security

- Upgraded `@modelcontextprotocol/sdk` to `^1.32.2` (GHSA-6qxp-vccf-f47h and related
  advisories) and `zod` to `^4.6.7` (GHSA-mrhx-c7xc-m3w5). Tool input schemas are now
  generated with zod 4's built-in `z.toJSONSchema`; `zod-to-json-schema` is no longer a
  dependency. The published tool schemas are unchanged (#3).
- `recurly_request` no longer forwards method-override headers (`X-HTTP-Method-Override`,
  `X-HTTP-Method`, `X-Method-Override`), so the read-only guarantee also holds for headers
  (#5).
- `get_pdf` refuses PDF directories owned by another user or accessible to group/others,
  and writes atomically without following symlinks (#7).

### Documentation

- Documented `RECURLY_MAX_OUTPUT_BYTES` and the `_truncated` / `_response_too_large`
  envelopes. The response size limit shipped in 0.1.0 but was missing from the README
  and this changelog (#2).

## [0.1.1] — 2026-06-05

### Changed

- Releases are now published from CI via npm **OIDC trusted publishing** with build
  provenance (`.github/workflows/release.yml`), triggered when a GitHub Release is
  published — no long-lived npm token. No functional or API changes; the package
  contents are identical to 0.1.0.

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

[Unreleased]: https://github.com/francktrouillez/recurly-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/francktrouillez/recurly-mcp/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/francktrouillez/recurly-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/francktrouillez/recurly-mcp/releases/tag/v0.1.0
