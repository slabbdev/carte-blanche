# Sponsor surface map — what each sponsor offers, what we use, what remains

*The systematic answer to "did you dig EVERYTHING?" — inventoried surface by surface, from their
own public artifacts (SDKs, packages, APIs, docs), not from memory. Updated 2026-10-15.*

---

## PayPal (host)

| Surface | Status | Where in the repo |
|---|---|---|
| Orders v2 (create/capture, deterministic request ids) | ✅ core | `src/paypal/client.ts`, enforcer |
| Sandbox test-card funding + wallet human-approval flow | ✅ | adapter (`funding`), `/api/agent/purchase/resume` |
| Payee routing + `custom_id` metadata (sandbox constraint worked around) | ✅ | adapter (`payeeAsMetadata`) |
| **Agent-purchase labeling** (`custom_id = "cb\|agent=…\|mandate=…"`) | ✅ | enforcer, `npm run tx:label-proof` |
| Disputes v1 (list/get, `provide-evidence`, `send-evidence`, SAMPLE disputes) | ✅ | `src/disputes/`, `/dashboard` |
| Transaction Search (`custom_field` = our agent marker, PayPal-side detection) | ✅ | `npm run tx:label-proof` |
| Webhooks (+ signature verification via `verify-webhook-signature`) | ✅ | `POST /api/webhooks/paypal` (`PAYPAL_WEBHOOK_ID` to activate verification) |
| Their official MCP server (`@paypal/mcp`) | ✅ analyzed | the gap-proof: money-moving tools, zero walls — pairs with ours |
| AP2 (Intent/Cart/Payment Mandates) | ✅ aligned | `docs/AP2-ALIGNMENT.md` |
| OAuth client-credentials token cache | ✅ | client |
| **AI-Toolkit** (github.com/paypal/AI-Toolkit): skill + hooks + MCP integration for Claude Code/Codex/Cursor | ✅ analyzed — **their own dev plugin injects "PayPal best practices" into agents; it ships NO enforcement either** — second confirmation of the gap from their own tooling | — |
| **Not yet used**: Vault + billing agreements (recurring agent spending — tomorrow-product #8), Payouts (an agent that RECEIVES money), WebMCP merchant onboarding, Checkout API (Channel3's own `/checkout` is "coming soon" too — the whole industry is missing it) | 📋 roadmap | — |

> ✅ **tomorrow-product #8 SHIPPED (2026-10-15)** — recurring mandates, no Vault changes needed:
> `limits.recurrence {frequency, maxPerWindow}` signed into the mandate; new `OVER_WINDOW_CAP` wall
> (distinct from `OVER_TOTAL_CAP`); spend-per-window read from the sealed chain (zero state outside
> it); calendar-aware windows (Jan 31 → Feb 28); standing journeys approved once
> (`{"recurrence":"monthly","months":12}`) and run per period (`{"cycle":"YYYY-MM"}`, retries
> idempotent per cycle); `npm run demo:recurring` — one signature, six months of authority, every
> refusal provable. A Vault token would only change the funding instrument; the authority layer
> above it is done.

## Render

| Surface | Status | Where |
|---|---|---|
| Web service (Frankfurt, free), health checks, auto-deploy | ✅ live | `render.yaml` |
| Blueprint (env vars, `sync: false` secrets, one-click Deploy button) | ✅ | `render.yaml`, README |
| Deploys API (trigger, poll, cancel), Services API, Env-var API (single-var upsert) | ✅ used operationally | deploy pipeline + the binding-incident recovery |
| Cron jobs (hourly TSA anchor) | 📋 declared (commented — paid starter) | `render.yaml` |
| Disks (persistent journal) | 📋 documented (paid) | `render.yaml` comment |
| Preview Environments (PR deploys, free) | 📋 next | — |
| MCP server / AI surfaces | ✅ checked: no official Render MCP found (docs 404, npm absent) — our Render deep-API usage (deploys/env/cancel) covers what an MCP would expose | — |

## AG Grid

| Surface | Status | Where |
|---|---|---|
| Grid: SSE async transactions, floating + quick filters, pinned column, pagination, row rules, column-state persistence, CSV export, custom renderers, theme API (quartz params) | ✅ Community ceiling reached (verified in v36 types: statusBar/sideBar/excelExport/rowGrouping/rangeSelection are Enterprise) | `/dashboard`, `/planner` |
| AG Charts (bar ×2) | ✅ | `/dashboard` |
| Enterprise features | 📋 need a hackathon/startup license | — |
| **Their official AI skill** (`ag-grid/skills`: ag-dev + ag-update), MCP server (`ag-mcp`), llms.txt + .md agent docs | ✅ **vendored**: `.agents/skills/` installed via `npx skills add ag-grid/skills` — all future grid work runs through their own guidance; we're on their latest (36.2.0, AG Charts 14.2.0) and their roadmap confirms our Community-ceiling read | `.agents/skills/` |

## Bryntum

| Surface | Status | Where |
|---|---|---|
| Calendar (deadlines timeline, custom renderer, live refresh, stockholm-light) | ✅ | `/dashboard` |
| TaskBoard ×2 (dispute kanban `/board`, journey execution board `/planner`) | ✅ | one UMD bundle per page (namespace constraint documented) |
| Scheduler / Gantt / recurring events / drag-drop | 📋 roadmap | — |
| Custom fields on task records | ✅ (declared via project `fields` — the /board cards carry amount/dates) | `/board` |
| UMD multi-bundle gotcha | ✅ documented (contribution candidate) | PROGRESSION + proposals |

## Channel3

| Surface | Status | Where |
|---|---|---|
| Search v1 (query, limit) + real response mapping (price objects, domains, buy links, ratings, cleaned images) | ✅ live key | `src/catalog/channel3.ts` |
| **Open package for other integrators** | ✅ extracted | `packages/channel3-lite/` — dependency-free client + mapper + tests (`npm test` inside), the real shape documented once so nobody rediscovers the price-object/domain/affiliate edges the hard way |
| **Pagination (`next_page_token`)** | ✅ just wired (API + mapper + script surface) | catalog route |
| Per-merchant offer comparison, cheapest-first | ✅ | console + planner |
| Sample fallback (with multi-merchant offers) | ✅ | offline demo path |
| **URL Lookup** (`/v1/lookup` — any retailer product URL → structured product + offers) | ✅ client method shipped (`lookupByUrl`); live probe returned empty with our key tier (documented) | `lookupByUrl()` |
| **Monetization** (`max_commission_rate` per offer) | ✅ mapped on offers — display/sum potential earnings in planner next | offers mapping |
| Their own `agents.md` + llms.txt (agent-readable surface, incl. `/checkout` "coming soon") | ✅ mined | — |

## APIMatic

| Surface | Status | Where |
|---|---|---|
| Validation v2 (`validate-via-file`) + agentic-tools linting | ✅ green (0 errors) | `npm run apimatic:sync` |
| Code Generation (`TS_GENERIC_LIB`) + SDK download | ✅ SDK committed | `sdk/typescript/` |
| Their platform API endpoints/auth (extracted from `@apimatic/sdk`) | ✅ documented | sync script |
| Developer portal (hosted) / import-via-file | ⚠️ their import endpoint 500s (alpha); portal needs workspace connection | — |
| Their own AI skills (github.com/apimatic/skills) | ✅ discovered — same pattern as AG Grid's (installable agent skills); candidate install like we did for AG Grid | github.com/apimatic/skills |

---

**Method note:** everything above was dug from the sponsors' own public artifacts — their SDKs,
their npm packages, their REST APIs probed with live keys, their GitHub repos. No speculation.
