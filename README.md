# recurly-mcp

[![CI](https://github.com/francktrouillez/recurly-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/francktrouillez/recurly-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/recurly-mcp.svg)](https://www.npmjs.com/package/recurly-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

A **read-only** MCP (Model Context Protocol) server that exposes the [Recurly v2021-02-25 API](https://recurly.com/developers/api/v2021-02-25/index.html) to LLM clients. Works with any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Cline, Codex CLI, Continue.dev, etc.).

Thirty resource-grouped tools cover every read (`GET`) endpoint Recurly exposes — accounts, subscriptions, invoices, transactions, line items, plans, coupons, items, usage, exports, external products/subscriptions, and the rest — plus a generic `recurly_request` escape hatch for anything not directly modeled.

**This server is read-only by construction: the HTTP client only ever issues `GET`. There is no code path that can create, update, or delete Recurly data — including via the escape hatch.**

**Unofficial. Not affiliated with or endorsed by Recurly.**

## Install

### Claude Code (one-liner)

```bash
claude mcp add recurly --scope user \
  --env RECURLY_API_KEY=YOUR_PRIVATE_API_KEY \
  -- npx -y recurly-mcp
```

Restart Claude Code and the `recurly_*` tools become available.

### Run the binary directly (optional)

The server is normally spawned by your MCP client over stdio. To test it stand-alone:

```bash
RECURLY_API_KEY=your_private_api_key npx recurly-mcp
```

It will wait for JSON-RPC messages on stdin. Useful for debugging the install only.

## Configuration

All configuration is via environment variables.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `RECURLY_API_KEY` | yes | — | Private API key. Sent as the HTTP Basic auth username (empty password). |
| `RECURLY_REGION` | no | `us` | `us` or `eu` — selects the API host. |
| `RECURLY_HOST` | no | `https://v3.recurly.com` | Override the API origin entirely (local mocks, proxies). Overrides `RECURLY_REGION`. |
| `RECURLY_API_VERSION` | no | `v2021-02-25` | Recurly API version sent in the `Accept` header. The tool paths/params here are modeled on `v2021-02-25`. |
| `RECURLY_TIMEOUT_MS` | no | `15000` | Per-request timeout. |
| `RECURLY_MAX_RETRIES` | no | `2` | Retries on 429 and 5xx (honors `Retry-After`, equal-jitter backoff). |
| `RECURLY_MAX_OUTPUT_BYTES` | no | `75000` | Max size (UTF-8 bytes of compact JSON) of a single tool result sent to the MCP client. Minimum `1000`. See [Response size limit](#response-size-limit). |
| `RECURLY_PDF_DIR` | no | `<os tmpdir>/recurly-mcp` | Directory where `recurly_invoices` `get_pdf` saves invoice PDFs. Created on first use with mode `0700` (an existing one must be yours and `0700`); a leading `~` is expanded; relative paths resolve against the server's working directory. |

Get a private API key from the Recurly dashboard → Integrations → API Credentials. Use a key scoped to read-only access where possible — this server never writes, but defense in depth is good.

## MCP client config

The MCP entry below is the same for every MCP client — only the config file location differs.

```json
{
  "mcpServers": {
    "recurly": {
      "command": "npx",
      "args": ["-y", "recurly-mcp"],
      "env": {
        "RECURLY_API_KEY": "your_private_api_key_here"
      }
    }
  }
}
```

Where to put it, by client:

| Client | Location |
|---|---|
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Code** | `~/.claude.json` — or use `claude mcp add recurly --scope user --env RECURLY_API_KEY=… -- npx -y recurly-mcp` |
| **Cursor** | `.cursor/mcp.json` (per-project) or `~/.cursor/mcp.json` (user-wide) |
| **Cline (VS Code)** | VS Code Settings → Cline → MCP servers (UI), or `cline_mcp_settings.json` |
| **Codex CLI** | `~/.codex/config.json` under `mcpServers` |
| **Continue.dev** | `.continue/config.json` under `experimental.modelContextProtocolServers` |

For the EU data region, add `"RECURLY_REGION": "eu"` to `env`.

## Tools

Every action is read-only, and every tool advertises this through MCP [tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool) (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`) plus a human-readable `title`, so clients that honor these hints can display the tools as safe or auto-approve them. Each tool takes an `action` discriminator plus the parameters for that action.

| Tool | Actions |
|---|---|
| `recurly_sites` | `list`, `get` |
| `recurly_accounts` | `list`, `get`, `get_balance`, `get_acquisition`, `list_acquisitions`, `list_child_accounts`, `list_notes`, `get_note`, `list_entitlements` |
| `recurly_billing_info` | `get`, `list`, `get_one` |
| `recurly_shipping_addresses` | `list`, `get` |
| `recurly_coupons` | `list`, `get`, `list_unique_coupon_codes`, `get_unique_coupon_code` |
| `recurly_coupon_redemptions` | `list_for_account`, `list_active_for_account`, `get_for_account`, `list_for_invoice`, `list_for_subscription`, `get_for_subscription` |
| `recurly_credit_payments` | `list`, `get`, `list_for_account` |
| `recurly_invoices` | `list`, `get`, `get_pdf`, `list_line_items`, `list_related`, `list_for_account` |
| `recurly_line_items` | `list`, `get`, `list_for_account` |
| `recurly_subscriptions` | `list`, `get`, `get_change`, `get_preview_renewal`, `list_invoices`, `list_line_items`, `list_for_account` |
| `recurly_transactions` | `list`, `get`, `list_for_account` |
| `recurly_custom_field_definitions` | `list`, `get` |
| `recurly_items` | `list`, `get` |
| `recurly_measured_units` | `list`, `get` |
| `recurly_plans` | `list`, `get`, `list_add_ons`, `get_add_on` |
| `recurly_add_ons` | `list`, `get` |
| `recurly_shipping_methods` | `list`, `get` |
| `recurly_usage` | `list`, `get` |
| `recurly_export` | `get_dates`, `get_files` |
| `recurly_dunning_campaigns` | `list`, `get`, `list_email_templates` |
| `recurly_invoice_templates` | `list`, `get`, `list_accounts` |
| `recurly_external_products` | `list`, `get`, `list_references`, `get_reference` |
| `recurly_external_subscriptions` | `list`, `get`, `list_invoices`, `list_payment_phases`, `get_payment_phase`, `list_for_account` |
| `recurly_external_invoices` | `list`, `get`, `list_for_account` |
| `recurly_external_accounts` | `list`, `get` |
| `recurly_general_ledger_accounts` | `list`, `get` |
| `recurly_performance_obligations` | `list`, `get` |
| `recurly_price_segments` | `list`, `get` |
| `recurly_business_entities` | `list`, `get`, `list_invoices` |
| `recurly_gift_cards` | `list`, `get` |
| `recurly_request` | Escape hatch — a raw `GET` to any Recurly API path. |

Tools return raw Recurly JSON payloads with no field-stripping. `list` actions add a `_pagination` metadata object so the model can iterate pages.

### IDs and codes

Most ID parameters accept **either** the opaque Recurly object ID (e.g. `e28zov4fw0v2`) **or** a prefixed human key:

- accounts/plans/items/coupons/…: `code-<your_code>`
- sites: `subdomain-<name>`
- invoices: `number-<invoice_number>`
- subscriptions/transactions: `uuid-<uuid>`

Values are URL-encoded before interpolation, so codes containing special characters work, and path-traversal segments are rejected.

### Pagination

Recurly uses cursor-based pagination. Each `list` action accepts exactly the query params Recurly documents for its endpoint, so they vary per endpoint: most take `limit` (1–200), `order` (`asc`/`desc`), `sort`, `ids`, `begin_time` and `end_time`, plus resource-specific filters (`state`, `type`, etc.), but some take only a subset (e.g. `recurly_billing_info` `list` has no `limit`/`order`, and `recurly_gift_cards` `list` takes no filters at all). Every `list` action accepts `cursor`. `sort` and the resource filters with a fixed set of values (`state`, `type`, `past_due`, …) are enums of the values Recurly allows for that endpoint (e.g. subscription `state` takes `active`, `canceled`, `expired`, `future`, `in_trial` or `live`, while invoice `state` takes `pending`, `paid`, `past_due`, …), so an unsupported value is rejected up front. A param the endpoint does not support is rejected with a validation error naming it, rather than silently ignored. Responses include Recurly's native `has_more`/`next`, and this server adds a `_pagination` hint:

```json
{ "object": "list", "has_more": true, "next": "/accounts?cursor=…", "data": [ … ],
  "_pagination": { "has_more": true, "next_cursor": "…" } }
```

Pass `_pagination.next_cursor` back as `cursor` to fetch the next page.

### Response size limit

MCP clients cap how much a single tool result may contain; past that, the result is spilled to a file and the model loses inline visibility. Every result is therefore capped at `RECURLY_MAX_OUTPUT_BYTES` (default `75000`, roughly 19k tokens):

- **Lists** keep as many leading items as fit and add a `_truncated` object. `has_more`, `next` and `_pagination` are preserved, so paging still works:

  ```json
  { "object": "list", "data": [ … ], "_pagination": { … },
    "_truncated": { "reason": "response_exceeded_max_bytes", "max_bytes": 75000,
                    "returned_items": 42, "omitted_items": 158, "hint": "…" } }
  ```

  Ask again with a smaller `limit` or narrower filters to see the omitted items.
- **Single resources** that do not fit are replaced by a `_response_too_large` object carrying `max_bytes`, `actual_bytes`, `object`, `id` and a hint (plus `content_type`/`byte_length` for binary files).
- **Error messages** are truncated to the same limit.

Raise the limit if your client accepts larger results.

### Invoice PDFs

By default, `recurly_invoices` `get_pdf` saves the PDF to disk under `RECURLY_PDF_DIR` (file name derived from the sanitized invoice id) and returns only metadata:

```json
{ "object": "binary_file", "content_type": "application/pdf", "byte_length": 123456, "sha256": "…", "path": "/tmp/recurly-mcp/invoice-number-1001.pdf" }
```

Invoices contain personal data. Files are written with mode `0600` inside a `0700` directory (an existing directory must be owned by you with no group/other access, or it is refused), and a repeat download overwrites the same file. The server never deletes them — cleaning up is the caller's/user's responsibility.

Pass `"delivery": "inline"` to get the bytes back as a base64 wrapper instead (still subject to the tool-output size cap, so only small PDFs fit):

```json
{ "object": "binary_file", "content_type": "application/pdf", "encoding": "base64", "byte_length": 12345, "data": "JVBERi0…" }
```

Base64 inflates the PDF by about a third, so with the default [response size limit](#response-size-limit) any inline PDF larger than roughly 55 KB comes back as a `_response_too_large` envelope instead. Raise `RECURLY_MAX_OUTPUT_BYTES` if you need larger PDFs inline.

### Coverage notes

- **Write operations are intentionally not modeled.** This is a read-only server; the client cannot issue anything but `GET`.
- **Filters beyond the common set** are reachable via `recurly_request` (`{ "path": "/...", "query": { … } }`) if a specific list endpoint accepts a parameter not modeled on its typed tool.

## Development

```bash
npm install
npm test                 # vitest
npm run typecheck
npm run lint
npm run build            # emits dist/
npm run validate         # spawns the built server, checks tool schemas (expects 31 tools)
npm run dev              # tsx src/bin.ts (for local stdio testing)
npm run parity           # diff our tools against Recurly's published OpenAPI spec
```

`npm run parity` fetches Recurly's OpenAPI spec ([`recurly-client-node/openapi/api.yaml`](https://github.com/recurly/recurly-client-node/blob/master/openapi/api.yaml)) and compares its GET endpoints and query params with what our tools actually call (derived from the tool registry; `recurly_request` is excluded). It exits 1 when the spec has a GET endpoint no tool covers, or a query param a covered endpoint accepts that our action doesn't. Params we accept that the spec doesn't list, endpoints we call that it doesn't document, and uncovered deprecated endpoints are warnings; `--strict` turns them into errors. `cursor` is always allowed. To use a local copy: `npm run parity -- ./api.yaml` (or set `RECURLY_OPENAPI_SPEC` to a path or URL). The [`spec-parity`](.github/workflows/parity.yml) workflow runs it weekly; a failing run means the spec has drifted.

## Contributing

Issues and pull requests welcome at <https://github.com/francktrouillez/recurly-mcp/issues>.

Bug reports are most useful with: the tool and action you called, the params (with secrets redacted), and the response.

## License

MIT
