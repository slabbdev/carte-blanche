# Devpost submission — Carte Blanche

*Paste-ready content for each Devpost field. Links to update at submission time are marked ⚠️.*
*Judging (official rules): five equally weighted criteria — Technological Implementation, Design,
Potential Impact, Innovation/Idea, Presentation — ties broken on the first. Judges may judge on
the text, images and video alone: every claim below is demonstrated in the video or one click
away in the live app.*

---

## Project name

**Carte Blanche**

## Tagline (≤ 60 chars)

Your agent shops. You keep the keys. Sellers keep the proof.

## Elevator pitch

An AI agent with a payment tool is a walking blank check — and when its purchase goes wrong,
nobody has evidence: not the buyer ("I never told it that"), not the seller ("the agent ordered
it"), not the rail. Carte Blanche is the authorization **and arbitration** layer between agents
and PayPal: signed spending mandates (per-purchase cap, merchant allowlist, budget, recurrence),
the buyer's own words **sealed at the moment of purchase**, signed receipts and signed refusals,
and — on the seller's side — a Resolution Center that turns all of it into the evidence PayPal's
dispute slots actually accept. One PayPal account, both faces, exactly like PayPal. Built on
PayPal sandbox rails with zero rail changes, live today.

## Inspiration

Agentic commerce stopped being a forecast this autumn. Stripe reported agent-initiated purchases
on Link **multiplied by 38 in September 2026** (~200 agents, ~$100 tickets), naming PayPal among
the rails "preparing their own solutions". Amex presented its **Intent Intelligence Framework**
on 13 October 2026 — intent + limits → token → non-compliant purchase blocked. Mastercard's
**Verifiable Intent** (open spec with Google, March 2026) formalises the authorization chain:
issuer → user constraints → agent proves scope.

All of it is the *authorization* half. The press sentence that started this project is the other
half: *"the delicate case is when the purchase was authorized but badly executed by the agent…
hence the value of keeping a clear trace of your instructions."* No protocol writes down what
happens then — who holds the buyer's words, what the seller submits, which of PayPal's evidence
slots it fits. We verified the gap on PayPal's own surfaces: the official `@paypal/mcp` server
moves money with no approval hook (so we put it behind ours — see below), the official AI-Toolkit ships best practices but no
enforcement, and pre-dispute alerts have **no webhook at all** (verified: `PRE_DISPUTE_ACTIVITY`
is not a valid event name). So we built the layer where authorization becomes evidence — for the
buyer, the seller and the agent, verifiable by anyone, with no trust in us.

## What it does

**For the buyer (PERSONAL account → the Agent console)**

- **Mandates** — an Ed25519-signed, immutable spending mandate: per-transaction cap, cumulative
  cap, currency, payee allowlist, time window and **recurrence** ("up to $40/month at the
  grocer"). Only revocation changes behavior; it is instant and journalled.
- **"Say it, the agent does the rest"** — a prompt + a budget. The autopilot shops the live
  catalog and buys under the mandate; the **buyer's verbatim words are sealed** (`intent_text`,
  SHA-256 of the full utterance, channel, session) into the journal and stamped on the receipt.
  The "I never told my agent that" defense, on the rail instead of in a chat log.
- **Enforcement before money moves** — every mutative call is checked; violations return
  **signed proofs of refusal** naming the wall (`OVER_PER_TRANSACTION`, `OVER_WINDOW_CAP`,
  `OVER_TOTAL_CAP`, `PAYEE_NOT_ALLOWED`, `MANDATE_REVOKED`…). A refusal is evidence of the
  principal's standing decision, not an error.
- **Purchase journeys** — plan a basket from the live catalog, approve ONCE: the mandate is
  derived from the basket (allowlist from merchants, caps from the lines). Price drops re-price
  the lines; if the agent already paid, **price protection refunds the difference** — a real
  PayPal refund, journalled.
- **Oversight** — every agent purchase with its evidence pack, agent **passports** (Ed25519,
  `did:cb:ed25519:…`, proof-of-possession), the STOP switch, and **sealed contestations**: one
  click seals the buyer's dispute intent before it is filed on PayPal.
- **Public verification** — anyone holding a receipt or refusal id verifies every signature and
  the chain position at `/verify/<id>` — no account. Each receipt carries a Merkle inclusion
  proof against a signed tree head; checkpoints are anchored by **RFC 3161 timestamps**.

**For the seller (BUSINESS account → the Resolution Center)**

- **One list, two faces** — cases *against my sales* and cases *filed by me*, like PayPal's own
  Resolution Center, with the real merchant balance from Transaction Search.
- **Coverage matrix** — each case is scored against the evidence slots PayPal really accepts for
  that reason (`PROOF_OF_FULFILLMENT`, `PROOF_OF_REFUND`, `OTHER`), producing a recommendation:
  **FIGHT** (signed mandate + sealed words = the case is falsified) or **REFUND FIRST** (no
  tracking on ITEM_NOT_RECEIVED → settle inside the inquiry window, no $15–30 fee).
- **Fast lane** — refund now (real `/v2/payments/captures/{id}/refund`) or fight with the pack;
  **fulfillment slot** with real shipment trackers (`/v1/shipping/trackers`); evidence pack
  submitted to PayPal's Disputes API in one click.
- **Automation rules, coverage-aware** — "auto-refund ITEM_NOT_RECEIVED under €50" like PayPal's
  own automation, except a rule **never settles a case the signed mandate would win**.
- **Seller health** — dispute rate vs PayPal's ~1.5 % threshold, a deadline banner for cases due
  within 3 days, net-after-fees on every sale, a one-click amicable message for INQUIRY-stage
  cases, and a Bryntum deadlines timeline / dispute kanban.
- **Analytics (AG Studio)** — self-serve dashboards over sales, disputes, agent receipts,
  refusals, mandates and a health summary; edit any widget or ask the Studio agents to build
  one ("agent vs human sales by day"); our **Threshold KPI** tile judges one number against the
  threshold PayPal applies.

**For agents and integrators**

- **PayPal's own agent tools, behind the wall** — the instance runs PayPal's official MCP server
  (`@paypal/mcp`) as a child and re-exposes all **28 tools** unchanged (`paypal_create_order`,
  `paypal_pay_order`, `paypal_create_refund`, invoices, subscriptions, tracking, disputes…) with
  one rule: a live signed mandate for every call, the money walls for the three that spend
  (`pay_order` reads the order back before capturing), signed denials for refusals, and the sealed
  journal for everything forwarded. Live-proven on sandbox: an order created through the wall, a
  45 USD order refused at a 30 USD cap before PayPal heard about it.
- An **MCP server** (14 tools of ours + the 28 above = 42) exposing the same API as agent tools — the purchase tool documents
  `intent_text` as MUST-pass; `llms.txt` for agents that read before they act; an OpenAPI 3.0
  contract validated by APIMatic with a generated TypeScript SDK and a prototype that generates
  an MCP server (23 tools) straight from the spec.
- Every PayPal order is stamped `cb|agent=…|mandate=…` in `custom_id`, so agent purchases are
  **detectable on PayPal's own Transaction Search** without PayPal changing anything (proven
  live).
- **Track records** — signed agent reputation computed from the sealed chain.

## How we built it

- **Stack** — TypeScript/Node, Express API, **React + Vite SPA** (PayPal's own front-end stack)
  styled as a PayPal back-office; a strict no-float rule in the authorization path (bigint minor
  units only). 100 tests across 21 files; every demo stage sealed in a tamper-evident journal.
- **PayPal rails — seven API families, all live on sandbox**: Orders v2 (create/capture,
  deterministic `PayPal-Request-Id`), Payments v2 (refunds for the fast lane and price
  protection), Disputes v1 (list/get/provide evidence), Shipment Tracking v1, Transaction Search
  (real balance via `ending_balance`, agent-marker detection via `custom_field`), Webhooks with
  signature verification (`CUSTOMER.DISPUTE.*`, `PAYMENT.CAPTURE.COMPLETED`), and **Identity /
  Connect with PayPal (OpenID Connect)** — the only way to log in: no demo form, one PayPal
  account, both faces. Wallet flow with `@paypal/react-paypal-js`. **PayPal's AI tools too**: the
  official MCP server (`@paypal/mcp`, on their agent-toolkit) runs inside the instance and its 28
  tools are served through the enforcer — we did not rebuild PayPal's tools, we put the walls
  around them.
- **Cryptography** — Ed25519 (server-custodial AND non-custodial: the browser can hold the
  principal's keys via WebCrypto, the server verifies only), canonical JSON under every
  signature, padded Merkle trees for inclusion proofs, RFC 3161 timestamp tokens anchored into
  the chain, agent passports with proof-of-possession.
- **AI** — the autopilot runs an LLM policy over the same HTTP tools a human uses (any
  OpenAI-compatible endpoint via `OPENAI_BASE_URL`), with a deterministic scripted fallback so
  the walls can be demonstrated without a key. The model never touches money directly: it calls
  the purchase tool, the enforcer decides.
- **Sponsors, each at a verified depth**:
  - **AG Grid** — **AG Studio** (`/analytics`): the seller's self-serve dashboard over six tables
    from the evidence layer and PayPal's records, two pre-built pages, a **custom "Threshold KPI"
    widget** (one number judged against the threshold PayPal applies — dispute rate vs 1.5 %),
    and the **Studio Agent Framework** wired through our own LLM proxy (the key never reaches
    the browser; any OpenAI-compatible model) with prompt starters a merchant would actually
    ask — "which walls held?", "cases due within 3 days", "refund-spike watch". Plus
    `ag-grid-react` 36 (JSX cell renderers, pinned pills, quick filters, CSV, Theming API) for
    the Resolution Center and journey grids, and AG Charts; their official AI skills vendored.
  - **Bryntum** — Calendar (dispute deadlines) and TaskBoard ×2 (dispute kanban, journey board),
    including a documented v7 `taskRenderer` behaviour and the one-bundle-per-page constraint.
  - **APIMatic** — the OpenAPI contract validated through their API, a committed TypeScript SDK,
    and an **OpenAPI → MCP generator prototype** plus a Context Plugin scaffold.
  - **Channel3** — live product search + offers feeding the agent, **price tracking** wired to
    recurring mandates and price protection, extracted as the open `channel3-lite` package.
  - **Render** — the live deployment, operated through their deploys/env-vars API (including
    recovering from a dead GitHub binding), Blueprint with PR previews.

## Challenges we ran into

- **The free tier kills OAuth**: the buyer sits on PayPal's consent page, the instance spins down,
  the callback hits a dead process — so sessions and in-flight OIDC states are persisted and
  survive restarts.
- **Business sandbox accounts** fail PayPal's `userinfo` with empty profiles — the login falls
  back to the `id_token` claims (and documents the PayPal-side consent loop we could not fix).
- PayPal's sandbox card rails ignore payee routing — solved by carrying payee intent in
  `custom_id`, which became a feature: the agent-purchase label visible in Transaction Search.
- **Pre-dispute alerts have no API**: `PRE_DISPUTE_ACTIVITY` is not a valid event name; the
  earliest machine-readable signal is `CUSTOMER.DISPUTE.CREATED` — so the cockpit answers it with
  an instant stage playbook and the fast lane, and the missing webhook became our ask to PayPal.
- Evidence slots are strict: claiming `PROOF_OF_REFUND` without a journalled refund poisons a
  case — the pack only targets slots it can honestly fill.
- Channel3's real response shape (price objects, domain merchants, near-duplicate listings) is
  mapped once, pinned by tests, de-duplicated by token key, published as a package.
- Bryntum v7's `taskRenderer` mutates a config object (return value ignored), and trial bundles
  cannot share a page; React StrictMode double-invokes singleton UMD widgets — all documented.

## Accomplishments we're proud of

- **Both faces run live on real PayPal sandbox rails** — a real Connect-with-PayPal login, a
  real merchant balance, real refunds, real shipment trackers, real dispute evidence submission.
- **The four-actor story on one command** (`npm run demo:full`): buyer signs intent → agent
  shops the live catalog → mandate derived from the basket → off-list drift refused with signed
  proof → track record sealed (real order on a bestbuy.com product).
- **Three distinct walls from ONE standing mandate** (`npm run demo:recurring`) — per-transaction,
  per-window and mandate-wide refusals, resetting each month.
- **Activation sealing** — the buyer's words become evidence at purchase time, landing in the
  seller's pack as its own section.
- **Coverage-aware automation** — the only dispute auto-rules we know of that read the signed
  mandate before refunding.
- **PayPal's 28 official agent tools behind the wall** — `@paypal/mcp` unchanged, every call under
  a signed mandate; `pay_order` reads the order back before capturing; a 422 "payer has not
  approved" is recognised as not-a-spend and never counted.
- **Agent purchases visible on PayPal's side** via `custom_id` — a bridge PayPal can adopt with
  zero effort; the **AP2 mapping**: every "future work" item in PayPal's AP2 docs has a running
  counterpart here (docs/AP2-ALIGNMENT.md).

## What we learned

- The hard part of agent payments is not authorization, it is **arbitration**: evidence is the
  product. Signed refusals are as valuable as signed receipts — they prove what the human decided.
- The seller is the forgotten actor. Every protocol protects the buyer's authorization; nobody
  tells the merchant which slot to fill, when to refund, or that their dispute rate is at stake.
- Idempotency is a safety feature: logical keys + deterministic request ids mean a buggy agent
  retry loop literally cannot double-spend.
- Prior art is a map, not a threat: Verifiable Intent and the Amex framework specify the
  authorization chain we implement; the words, the artifacts and the seller's workflow are where
  we go further.

## How this differs from existing concepts

| | Authorization chain | Buyer's words sealed | Signed refusals | Seller dispute workflow | Live on a rail |
|---|---|---|---|---|---|
| Mastercard **Verifiable Intent** (Mar 2026, draft v0.1) | ✅ 3-layer SD-JWT, 8 constraint types | — | — | — | spec |
| Visa **Trusted Agent Protocol** (Oct 2025) | agent identity (signed requests) | — | — | — | merchant-side signal |
| Amex **Intent Intelligence** (Oct 2026) | ✅ intent token + limits | — | blocks, no artifact | — | announced |
| Stripe **Link** agents | virtual card + caps | — | — | — | ✅ |
| **ACP / AP2 / x402**, `@paypal/mcp` | checkout & payment protocols | — | — | — | ✅ |
| **Carte Blanche** | ✅ signed mandate + agent passports | ✅ `intent_text` + SHA-256 | ✅ | ✅ coverage matrix, fast lane, trackers, rules | ✅ PayPal sandbox |

## What's next

- **Pre-dispute webhook** — our ask to PayPal: expose Resolution-Center pre-chargeback alerts as
  an event, so the fast lane can act inside the ~20 h refund window automatically.
- **Seller → buyer messaging** through an API (today: one-click amicable message to paste).
- **Shipping labels** — today we push carrier tracking to PayPal; label generation is next.
- **Buyer-side filing** end-to-end once buyer filing APIs open up (intents and evidence seal today).
- Publish `channel3-lite` and the OpenAPI → MCP generator; merchants accepting
  `cb|agent=…|mandate=…` labels at checkout become dispute-free by construction.

## Built with

`typescript` · `react` · `vite` · `express` · `paypal-orders-v2` · `paypal-payments-v2` ·
`paypal-disputes-v1` · `paypal-shipment-tracking` · `paypal-transaction-search` ·
`paypal-webhooks` · `connect-with-paypal-oidc` · `react-paypal-js` · `ed25519` · `merkle-trees` ·
`rfc3161-tsa` · `ag-studio` · `ag-grid-react` · `ag-charts` · `bryntum-calendar` · `bryntum-taskboard` ·
`channel3-api` · `apimatic` · `render` · `mcp` · `openai-compatible-llm`

## Links

- ⚠️ Live app (PayPal sandbox): https://carte-blanche-6jgo.onrender.com
- ⚠️ Interactive explainer: https://slabbdev.github.io/carte-blanche/
- ⚠️ Repo: https://github.com/slabbdev/carte-blanche
- ⚠️ Video (< 3 min, YouTube public): **TO UPLOAD** — re-shot on the React back-office
- Contract: https://carte-blanche-6jgo.onrender.com/openapi.json · `llms.txt` at the root ·
  `/docs` API reference

## Try it in 60 seconds (judges)

Login is the **real Connect-with-PayPal flow** (sandbox) — no demo form. Use the sandbox test
account below or your own sandbox account from the PayPal Developer Dashboard. A PERSONAL
account opens on the buyer's seat, a BUSINESS account on the seller's seat; both seats are one
click apart in the sidebar.

> ⚠️ **Judge sandbox account (PERSONAL):** `email` / `password` — *to be filled before
> submission; also listed in the repo README under "Testing".*

1. **Agent console** (`/`) — grant a mandate, then type a goal and a budget in **Achat
   automatique**: the agent buys under the mandate and your words are sealed on the receipt.
   Try a goal that exceeds the cap → a **signed refusal** names the wall.
2. **Journey planner** (`/planner`) — search the live catalog, add lines, approve once; inject a
   sample price drop and watch the lines re-price (and refund if already paid).
3. **Oversight** (`/oversight`) — every purchase with its evidence pack; press **🛡️ Dispute** to
   seal a contestation before it ever reaches PayPal.
4. **Resolution Center** (`/dashboard`) — the seller's seat: pick the case → coverage matrix,
   FIGHT / REFUND FIRST recommendation, fast lane, evidence pack (markdown + JSON) with the
   buyer's sealed words, one-click submit to PayPal; the deadlines timeline and dispute board.
5. **Analytics** (`/analytics`) — the AG Studio dashboard: KPI tiles, charts and grids over the
   six tables; open the agent panel and pick a prompt starter.
6. **Verify anything** (`/verify`) — paste any receipt or refusal id: every signature and the
   Merkle inclusion proof check in your own browser, no account.

Without PayPal credentials, the scripted demos run the whole story on mock rails:
`npm run demo`, `npm run demo:intent`, `npm run demo:recurring`, `npm run demo:full`.
