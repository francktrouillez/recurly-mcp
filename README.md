# recurly-mcp

[![CI](https://github.com/francktrouillez/recurly-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/francktrouillez/recurly-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/recurly-mcp.svg)](https://www.npmjs.com/package/recurly-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

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

Every action is read-only. Each tool takes an `action` discriminator plus the parameters for that action.

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
| `recurly_dunning_campaigns` | `list`, `get` |
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

Recurly uses cursor-based pagination. `list` actions accept `limit` (1–200), `order` (`asc`/`desc`), `sort`, `cursor`, `ids`, `begin_time`, `end_time`, plus resource-specific filters (`state`, `type`, etc.). Responses include Recurly's native `has_more`/`next`, and this server adds a `_pagination` hint:

```json
{ "object": "list", "has_more": true, "next": "/accounts?cursor=…", "data": [ … ],
  "_pagination": { "has_more": true, "next_cursor": "…" } }
```

Pass `_pagination.next_cursor` back as `cursor` to fetch the next page.

### Invoice PDFs

`recurly_invoices` `get_pdf` returns the PDF as a base64 wrapper rather than a mangled string:

```json
{ "object": "binary_file", "content_type": "application/pdf", "encoding": "base64", "byte_length": 12345, "data": "JVBERi0…" }
```

### Coverage notes

- **Write operations are intentionally not modeled.** This is a read-only server; the client cannot issue anything but `GET`.
- **Filters beyond the common set** are reachable via `recurly_request` (`{ "path": "/...", "query": { … } }`) if a specific list endpoint accepts a parameter not modeled on its typed tool.

## Development

```bash
npm install
npm test                 # vitest, 154 tests
npm run typecheck
npm run lint
npm run build            # emits dist/
npm run validate         # spawns the built server, checks tool schemas (expects 31 tools)
npm run dev              # tsx src/bin.ts (for local stdio testing)
```

## Contributing

Issues and pull requests welcome at <https://github.com/francktrouillez/recurly-mcp/issues>.

Bug reports are most useful with: the tool and action you called, the params (with secrets redacted), and the response.

## License

MIT
