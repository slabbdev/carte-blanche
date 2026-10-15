# Devpost submission — Carte Blanche

*Paste-ready content for each Devpost field. Links to update at submission time are marked ⚠️.*

---

## Project name

**Carte Blanche**

## Tagline (≤ 60 chars)

Your agent shops. You keep the keys.

## Elevator pitch

An AI agent with a payment tool is a walking blank check: today's toolkits capture an order
because the model decided to. Carte Blanche is the enforcement + evidence layer between the
agent and PayPal — signed spending mandates (including "$40/month" standing authorities),
signed receipts, signed refusals, a sealed tamper-evident journal, public verification, and
dispute-proof evidence packs for buyers, merchants and agents alike. Built entirely on PayPal
sandbox rails, with zero rail changes.

## Inspiration

Agentic commerce is being built right now — ACP, AP2, x402, agent toolkits — and none of these
layers ship spend controls, human-reviewable receipts, or dispute evidence for agent-initiated
purchases. We verified the gap is real, not hypothetical: PayPal's own official agent toolkit
(`@paypal/mcp`) moves money with no approval hooks, and no protocol defines what happens when
an agent's purchase goes wrong. The cost center nobody prices is arbitration: when a buyer and
a merchant disagree about an agent's purchase, nobody has evidence. So we built the missing
layer: every claim in Carte Blanche is a signed artifact anyone can verify — no account, no
trust in us.

## What it does

- **Mandates** — a human grants an Ed25519-signed, immutable spending mandate: per-transaction
  cap, cumulative cap, currency, payee allowlist, time window, and **recurrence** ("up to
  $40/month at the grocer" — calendar-aware windows, per-window budget, automatic reset).
  Only revocation changes behavior, and it is instant and journalled.
- **Enforcement before money moves** — every mutative call is checked against the mandate;
  violations come back as **signed proofs of refusal** naming the exact wall that held
  (`OVER_PER_TRANSACTION`, `OVER_WINDOW_CAP`, `OVER_TOTAL_CAP`, `PAYEE_NOT_ALLOWED`,
  `MANDATE_REVOKED`…). A refusal is evidence of the principal's standing decision, not an error.
- **Deterministic execution** — PayPal-Request-Ids derived from logical keys: a framework retry
  can never double-spend; a re-run replays the same receipt.
- **Sealed journal** — every event lands in an append-only SHA-256 chain with signed checkpoints
  and **RFC 3161 TSA anchors** (an external authority vouches for the chain's position, so even
  key holders can't backdate).
- **Public verification** — anyone holding a receipt or refusal id verifies every signature and
  the chain position at `/verify/<id>` — no account. Each receipt carries a Merkle inclusion
  proof against a signed tree head.
- **Purchase journeys** — plan a basket from the live catalog, approve ONCE: the mandate is
  *derived from the basket itself* (allowlist from merchants, caps from the lines) and signed.
  Approve with recurrence and the same signature covers every period; run each month with a
  cycle key (idempotent per cycle).
- **The buyer's side** — `/oversight`: every agent purchase with its evidence pack, the STOP
  switch that ends an agent's authority instantly, and **sealed contestations**: one click
  seals the buyer's dispute intent (reason + receipt + order id) the moment it forms, so the
  buyer enters PayPal's Resolution Center carrying signed evidence, not screenshots.
- **Agent reputation** — track records computed from the sealed chain and signed: merchants can
  underwrite agent orders, buyers can delegate, based on verifiable history instead of vibes.
- **Agent-native surfaces** — an MCP server (13 tools) exposing the same API as agent tools,
  `llms.txt` for agents that read before they act, an OpenAPI 3.0 contract validated by
  APIMatic with a generated TypeScript SDK, and every PayPal order stamped with a
  `cb|agent=…|mandate=…` `custom_id` so agent purchases are **detectable on PayPal's own
  Transaction Search** without PayPal changing anything (proven live: labeled orders show up
  in their transaction search).

## How we built it

- **TypeScript/Node, no framework ceremony**: an Express server, plain web pages, and a strict
  no-float rule in the authorization path (bigint minor units only).
- **PayPal rails**: Orders v2 (create/capture), Disputes v1 (list/get + provide/send evidence),
  Transaction Search (agent-marker detection), Webhooks with signature verification
  (`CUSTOMER.DISPUTE.*` events verified end-to-end with a real sandbox capture), OAuth token
  caching. Card-funded sandbox orders + wallet flow with human approval at PayPal.
- **Cryptography**: Ed25519 (server-custodial AND non-custodial — the browser can hold the
  principal's keys via WebCrypto and the server verifies-only), canonical JSON over which every
  signature is computed, Merkle trees (CT-inspired, padded) for inclusion proofs, RFC 3161
  timestamp tokens anchored into the chain.
- **Sponsors, exhaustively**:
  - **PayPal** — the rail, the dispute system, the webhook fabric, transaction search; plus
    AP2 alignment: every gap PayPal's AP2 docs state as "future" is mapped to a shipped
    artifact (docs/AP2-ALIGNMENT.md).
  - **Channel3** — live product search + offers feeding the agent's shopping scene (real
    response shape mapped and pinned by tests), AND extracted as an open package
    (`packages/channel3-lite`) other integrators can use.
  - **AG Grid** — Community version at its verified ceiling: auto-generated grids, SSE async
    transactions, quick filters, CSV export, theme-quartz customization, AG Charts; their own
    official AI skills vendored into the repo drive all grid work.
  - **Bryntum** — Calendar (dispute deadlines timeline) and TaskBoard ×2 (dispute kanban,
    journey execution board), including a documented multi-bundle namespace constraint.
  - **APIMatic** — the OpenAPI contract is validated/linted through their API and generated
    into a committed TypeScript SDK; their own skills vendored too.
  - **Render** — the live deployment (Frankfurt, free plan), operated through their full
    deploys/env-vars/cancel API (including recovering from a dead GitHub binding),
    one-click Blueprint with `previewsEnabled` for PR previews.
- **Verification culture**: 81 tests (`npm test`), scripted demos for every story
  (`demo`, `demo:intent`, `demo:full`, `demo:recurring`), and every demo stage sealed into the
  NoireBox tamper-evident journal as we built.

## Challenges we ran into

- PayPal's sandbox card rails ignore payee routing — solved by carrying payee intent in
  `custom_id` metadata (which became a FEATURE: the agent-purchase label).
- Channel3's real response shape differs from anyone's assumption (price objects, domain
  merchants, affiliate links) — mapped once, pinned by tests, published as the open package.
- Bryntum trial bundles can't share a page (namespace collision) — one bundle per page,
  documented as a contribution candidate.
- Render's auto-deploy broke silently when the repo went private — re-bound and rebuilt the
  deploy pipeline on their raw API.
- The recurring feature itself surfaced a real design bug: wall-clock journal timestamps
  misattributed spends across simulated windows — the journal now stamps events at the
  enforcer's own clock, so per-window accounting is exact.

## Accomplishments we're proud of

- **The four-actor story runs on one command** (`npm run demo:full`): buyer signs the intent →
  agent shops the live catalog → mandate derived from the basket → drift refused with signed
  proof → track record sealed.
- **Three distinct walls, all signed, all from ONE mandate** (`npm run demo:recurring`): a
  standing $40/month authority that refuses per-transaction, per-window and mandate-wide
  violations differently — and resets automatically each month.
- **Agent purchases are visible on PayPal's side** via `custom_id` labels surviving into
  Transaction Search — a bridge PayPal can adopt with zero effort.
- **The AP2 mapping**: every "future work" item in PayPal's Agent Payments Protocol docs has a
  running counterpart in this repo.

## What we learned

- The hard part of agent payments is not authorization, it's **arbitration**: evidence is the
  product. Signed refusals turned out to be as valuable as signed receipts — they prove what
  the human decided, not just what the agent did.
- Idempotency is a safety feature: logical keys + deterministic request ids mean a buggy agent
  retry loop literally cannot double-spend.
- Sponsors' own artifacts (skills, MCP servers, docs) are the best integration guide — and
  integrating deeply enough to find their sharp edges (Channel3's price objects, Bryntum's
  bundles) is what makes the integration real.

## What's next

- PayPal Vault as the funding instrument behind standing mandates (the authority layer above
  it already ships).
- Buyer-side dispute flow end-to-end once buyer filing APIs open up (intents seal today).
- Merchants accepting `cb|agent=…|mandate=…` labels at checkout: dispute-free by construction.
- The MCP server gaining the dispute + track-record tools; publish `channel3-lite` to npm.

## Built with

`typescript` · `paypal-orders-v2` · `paypal-disputes-v1` · `paypal-webhooks` ·
`paypal-transaction-search` · `ed25519` · `merkle-trees` · `rfc3161-tsa` · `ag-grid` ·
`ag-charts` · `bryntum-calendar` · `bryntum-taskboard` · `channel3-api` · `apimatic` ·
`render` · `mcp` · `openai` (optional autopilot policy)

## Links

- ⚠️ Live app (PayPal sandbox): https://carte-blanche-6jgo.onrender.com
- ⚠️ Interactive explainer: https://slabbdev.github.io/carte-blanche/
- ⚠️ Repo: https://github.com/slabbdev/carte-blanche
- ⚠️ Video: (docs/video/carte-blanche-demo.mp4 — upload to Devpost/YouTube)
- Contract: https://carte-blanche-6jgo.onrender.com/openapi.json · `llms.txt` at the root

## Try it in 60 seconds (judges)

1. Open the live app → login (any email — the gate is real, the PayPal-style login is a demo).
2. Console: grant a mandate → buy as the agent → try to exceed the cap → **signed refusal** →
   verify it at `/verify/<id>` with no account.
3. `/planner`: search the live catalog, add lines, tick **standing basket**, approve → run →
   receipts and refusals in the grid; re-run next month with a cycle key.
4. `/oversight`: see every purchase, press **🛡️ Dispute** — your contestation is sealed with
   the evidence pack attached.
5. `/dashboard`: the Resolution Center view — disputes, deadlines (Bryntum), evidence packs.
6. `verify` anything at `/verify` — every signature checks in your own browser.
