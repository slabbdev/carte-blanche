# Carte Blanche

**Your agent shops. You keep the keys.**

Spending mandates, sealed receipts and dispute-proof audits for AI agents paying with **PayPal**.

**📄 AP2 alignment:** PayPal builds Agent Ready on the Agent Payments Protocol — [our mapping](docs/AP2-ALIGNMENT.md) shows every stated AP2 gap filled by a shipped Carte Blanche artifact.

**▶ One command, the whole story:** `npm run demo:full` — buyer signs the intent, the agent shops
the live catalog and proposes a basket, the mandate is derived from it, drift is refused with signed
proof, and the agent's track record is sealed. Sandbox rails with creds, mock without.

**▶ Interactive explainer with real signed artifacts: https://slabbdev.github.io/carte-blanche/**
(it replays a recorded run — press the buttons, watch refusals get signed, then verify everything
in your own browser with WebCrypto. Recorded by `scripts/capture-demo.ts`, served from `docs/`.)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/slabbdev/carte-blanche)

**▶ Live app on Render (PayPal sandbox rails): https://carte-blanche-6jgo.onrender.com** — log in
with a PayPal **sandbox** account (the real Connect-with-PayPal flow — a judges' test account is in
[Testing](#testing-judges)), grant a mandate, spend as the agent, watch a real sandbox order get
captured, then verify the receipt at `/verify/<id>`. A PERSONAL account opens on the buyer's seat,
a BUSINESS account on the seller's Resolution Center. Free instance: the first hit after ~15 min
idle can take ~50 s to wake.

An AI agent with a payment tool is a walking blank check — today's toolkits will capture an order
because the model decided to. Carte Blanche is the layer that sits between the agent and PayPal:

- **Mandates** — the principal grants a signed, immutable spending mandate (per-transaction cap,
  cumulative cap, currency, payee allowlist, time window). Revocation is instant and the only exit.
- **Enforcement** — every mutative call is checked against the mandate *before* money moves,
  executed with a deterministic `PayPal-Request-Id` (a retry can never double-spend), and answered
  with a signed receipt — or a **signed proof of refusal** naming the limit that blocked it.
- **Sealed journal** — every event lands in an append-only SHA-256 chain with signed checkpoints.
- **Public verification** — anyone holding a receipt or refusal id can verify all signatures and
  the journal at `/verify/<id>`, no account needed. It *is* the evidence pack: the seller's
  Resolution Center scores it against PayPal's real evidence slots and submits it to the Disputes
  API in one click.
- **The buyer's words, sealed** — the prompt that triggered a purchase (`intent_text`) is hashed
  and journalled at purchase time and stamped on the receipt: the "I never told my agent that"
  defense lives on the rail, not in a chat log.

## Why

Agentic commerce is being built (ACP, AP2, x402, agent toolkits) and none of these layers ship
spend controls, human-reviewable receipts, or dispute evidence for agent-initiated purchases.
The gap is documented, not hypothetical: the official PayPal agent toolkit has no approval hooks
and a client-level idempotence key (double-spend on retry); no protocol defines disputes for
agent purchases. Carte Blanche is a working answer on PayPal rails.

## Purchase journeys (the planner)

`/planner` is the whole stack in one screen: search the live catalog (Channel3), add lines to a
basket, **approve** — the mandate is *derived from the basket itself* (payee allowlist from the
lines' merchants, per-purchase cap from the priciest line, total cap from the sum) and signed — then
**run** it: every line is a real purchase through the enforcer, and the auto-generated AG Grid and
the Bryntum execution board fill with signed receipts and refusals. Lines added *after* the
signature run into the same walls — over-cap, off-list and over-budget lines come back as signed
refusals right in the grid. API: `POST /api/journeys`, `POST /api/journeys/:id/approve`,
`POST /api/journeys/:id/run` (in the contract, APIMatic-linted).

## Standing authority: "$40/month at the grocer" (recurring mandates)

Approve a basket with `{"recurrence":"monthly","months":12}` and the SAME signature becomes a
standing authority — the basket every month for a year, per-month budget = the basket,
mandate-wide cap = basket × periods. Each window gets its own wall: spend the month's budget and
the next attempt is refused with `OVER_WINDOW_CAP` (a different, signed answer to "the whole
mandate is spent" — `OVER_TOTAL_CAP`); the calendar-aware windows (Jan 31 → Feb 28) reset
automatically, and the spend-per-window is read from the sealed chain — zero recurring state
outside it. Run each period with `{"cycle":"2026-11"}`: retries within a cycle are idempotent,
the next month runs fresh, and running next month's cycle *early* is refused. One command:

```bash
npm run demo:recurring   # one signature, 6 months, 3 walls, every refusal signed
```

## The buyer's side: sealed contestations

`/oversight` is the buyer tab PayPal's app would grow — every agent purchase with its evidence
pack one click away, and **🛡️ Dispute**: picking a reason seals the buyer's contestation INTENT
(reason, receipt, order id) into the journal the moment it forms, so the buyer walks into PayPal's
Resolution Center carrying signed evidence instead of screenshots. Filing itself stays on PayPal's
side; the proof-of-what-the-buyer-said-and-when is ours to seal.

## The Amex pattern, open-sourced

Amex announced the **Intent Intelligence Framework** at TechCrunch Disrupt 2026: the agent
captures an intent, the human signs the parsed parameters, the network issues an ephemeral
proof-of-intent token, execution is bounded, deviations are rejected at the rail. That is
this project's architecture under another name — so we re-created the announced experience
end to end on PayPal rails, with sealed evidence at every stage:

```bash
npm run demo:intent    # 5 stages + 4 deviations; sandbox rails with creds, mock without
```

| Intent Intelligence (announced) | Carte Blanche (running) |
|---|---|
| 1. Create Intent API | the agent's parse lands as a mandate draft (merchant, item, max price, budget) |
| 2. human signs parsed parameters | Ed25519 over the canonical JSON of the *parse* — not the prose |
| 3. Intent ID + proof-of-intent token | mandate id + signed mandate; PayPal mints a single-use order bound by a deterministic `PayPal-Request-Id` |
| 4. bounded execution | the enforcer captures inside the signed constraints; receipt carries a Merkle inclusion proof |
| 5. deviation rejected at the rail | merchant swap / price escalation / budget escalation / token reuse — refused *before* money moves, each refusal signed |

Same pattern, different conclusion: it is not a proprietary framework, it is a standard any
rail can implement — and the evidence layer (signed refusals included) is what makes it
auditable after the fact.

## Prior art and neighbours

The authorization chain is being standardised — by three card networks at once. The buyer's words,
the signed artifacts and the seller's dispute workflow are not in any of them.

| | Authorization chain | Buyer's words sealed | Signed refusals | Seller dispute workflow | Status |
|---|---|---|---|---|---|
| Mastercard [Verifiable Intent](https://verifiableintent.dev) (Mar 2026) | ✅ 3-layer SD-JWT delegation chain, 8 constraint types (amounts, allowlists, budgets, recurrence) | — | — | — | draft v0.1 spec, protocol-agnostic (AP2/ACP/UCP) |
| Visa [Trusted Agent Protocol](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-unveils-trusted-agent-protocol-for-ai-commerce.html) (Oct 2025) | agent identity: signed agent requests merchants can verify | — | — | — | merchant-side signal, no token |
| Amex Intent Intelligence Framework (Oct 2026) | ✅ intent + limits → token, non-compliant purchase blocked | — | blocks, no artifact | — | announced |
| Stripe Link agent purchases | virtual card + spend caps | — | — | — | live (×38 in Sept 2026) |
| ACP · AP2 · x402 · `@paypal/mcp` | checkout / payment protocols and tools | — | — | — | live — and `@paypal/mcp` now runs **behind our wall** (28 tools, same arguments) |
| **Carte Blanche** | ✅ signed mandate + agent passports (Ed25519, `did:cb`) | ✅ `intent_text` + SHA-256 on the receipt | ✅ every wall names itself | ✅ coverage matrix, FIGHT / REFUND FIRST, fast lane, trackers, coverage-aware rules | live on PayPal sandbox |

Verifiable Intent is the closest prior art and we read it as confirmation: its constraint types are
our mandate limits, its "agent proves scope" layer is our passport. Where every spec stops —
*"the purchase was authorized but badly executed by the agent"* — is where the evidence layer
starts.

## Quickstart

```bash
npm install
npm run build
npm start          # rails: mock — clearly labeled MOCK-* ids
```

The web UI logs in **only through Connect with PayPal** (there is no demo form — one PayPal
account, both faces, like PayPal), so the back-office needs sandbox app credentials (next section)
plus a sandbox account to sign in with. Without credentials, everything else runs on mock rails:
the API, the MCP server, and the scripted stories — the fastest way to see the walls hold:

```bash
npm run demo             # mandate → purchases → refusals → verify (30 s, no server)
npm run demo:intent      # the intent-token pattern, 5 stages + 4 refused deviations
npm run demo:recurring   # one $40/month mandate, three different walls
npm run demo:full        # the four-actor story (live catalog with CHANNEL3_API_KEY)
```

## Real PayPal sandbox

Create a **Merchant** REST app in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox)
(choose the *Merchant* account type — *Platform* is for marketplaces / PayPal for Platforms partner
flows, which this doesn't need; a merchant app covers Orders, Disputes on your own transactions and
Transaction Search), then:

```bash
PAYPAL_MODE=sandbox PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npm start
```

Every id and capture then comes from the PayPal sandbox REST API (Orders v2).
`PAYPAL_MODE=mock` (default) is a dev simulator and never pretends to be PayPal.

## Testing (judges)

Everything below runs against the live app — https://carte-blanche-6jgo.onrender.com — on PayPal
**sandbox** rails. Judges are not required to test (text, images and video stand alone), but it
takes about a minute.

**Log in** with Connect with PayPal using a sandbox account — either the one below or any sandbox
account from your [Developer Dashboard](https://developer.paypal.com/dashboard/accounts). One
account carries both faces; the sidebar switches seats.

> ⚠️ **Judges' sandbox account (PERSONAL):** `email` · `password` — *filled before submission.*
> Business sandbox accounts can hit a PayPal-side consent loop ("Un problème est survenu"); the
> PERSONAL account reaches every page, including the seller's Resolution Center.

1. **Agent console** (`/`) — grant a mandate, type a goal + budget in *Achat automatique*: the
   agent buys under the mandate, your words are sealed on the receipt. Exceed the cap → a signed
   refusal names the wall.
2. **Journey planner** (`/planner`) — search the live catalog, add lines, approve once; inject a
   sample price drop → lines re-price, already-paid lines are refunded for the difference.
3. **Oversight** (`/oversight`) — every purchase with its evidence pack; **🛡️ Dispute** seals a
   contestation before it reaches PayPal.
4. **Resolution Center** (`/dashboard`) — the seller's seat: pick the case → coverage matrix,
   FIGHT / REFUND FIRST, fast lane, the evidence pack with the buyer's sealed words, one-click
   submit to PayPal's Disputes API; deadlines timeline and dispute board.
5. **Analytics** (`/analytics`) — the AG Studio dashboard over the same six tables; open the
   agent panel and pick a prompt starter ("which walls held?").
6. **Verify** (`/verify`) — paste any receipt or refusal id; every signature and the Merkle
   inclusion proof check in your browser, no account.

Locally: `PAYPAL_MODE=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… npm start` with the
redirect URI `http://localhost:8790/api/auth/paypal/callback` registered on the app; or the
scripted demos on mock rails (see Quickstart).

## MCP server — the evidence layer as agent tools

`npm run mcp` starts a stdio MCP server (works with Claude Desktop, Claude Code, any MCP client).
Fourteen tools of ours — `search_catalog`, `grant_mandate`, `mandate_status`, `purchase`, `my_artifacts`,
`verify_artifact`, `recall_preferences`/`save_preference`, `plan_journey`/`approve_journey`/
`run_journey`… — plus **PayPal's 28 official tools mounted behind the wall** (`paypal_*`, below):
42 tools, all funnelled through the same enforcer. The model gets a signed receipt or a signed
refusal, never rail access. Point `CB_BASE_URL` at any instance.

The console has an **🤖 Autopilot** button: one click runs the agent server-side under the selected
mandate — the LLM loop when `OPENAI_API_KEY` is set, a deterministic scripted policy otherwise
(search catalog → cheapest allowlisted offer within remaining budget → purchase). Transcript,
artifacts and the run itself are journalled (`agent_autopilot_run`). The browser never holds rails
access or keys.

### PayPal's own tools, behind the wall

PayPal's official MCP server (`@paypal/mcp`, built on their agent-toolkit) gives an agent
`create_order`, `pay_order`, `create_refund` and 25 more tools — with nothing but an access token.
No mandates, no limits, no evidence. We did not replace it: **the instance runs `@paypal/mcp` as a
child and re-exposes all 28 tools as `paypal_<name>`, same arguments, behind the wall.**

| Class | Tools | Rule |
|---|---|---|
| **spend** | `create_order`, `pay_order`, `create_refund` | measured against the mandate first — `create_order` priced from its items, **`pay_order` reads the order back (`get_order`) before capturing**, `create_refund` needs an explicit amount (a mandate cannot cover "whatever the capture was") |
| **write** | invoices, products, plans, subscriptions, tracking, `accept_dispute_claim` | a live signed mandate is required (authority), no money counted |
| **read** | `list_*`, `get_*`, `show_*`, `generate_*` | forwarded under a live mandate, journalled |

A refusal is the same signed denial a purchase gets, verifiable at `/verify/<id>`; PayPal is never
called. Forwarded calls land in the sealed journal (`external_call_authorized` →
`external_call_completed` / `external_call_failed` / `external_spend`), and money is counted
against the caps only when PayPal confirms it moved — a `422 payer has not approved` arrives as a
perfectly well-formed JSON answer, and is not a spend. REST: `GET /api/paypal-tools`,
`POST /api/paypal-tools/:tool` (`mandate_id`, `arguments`, `intent_text`). Live-proven on sandbox:
order `94530697LT008715N` created through the wall at 24.50 USD; a 45.00 USD order refused with
`deny-f3fa3742709325f8` (`OVER_PER_TRANSACTION`) before PayPal heard about it.

**Their server gives agents the keys; ours gives them the walls — and now the keys come through the
walls.** Agent-readable API map at [`/llms.txt`](https://carte-blanche-6jgo.onrender.com/llms.txt).

## Agent-purchase detection — labeled on PayPal's own records

PayPal cannot tell an agent purchase from a human one: to their rails, an agent order is just
another API call. Carte Blanche closes that blind spot without PayPal changing anything — every
order it mediates carries an agent marker in `custom_id`:

```
custom_id = "cb|agent=shopping-agent-1|mandate=cbmd-…|payee=merch@keymagic.example"
```

The marker survives into PayPal's own transaction records — `npm run tx:label-proof` reads their
Transaction Search API and shows agent purchases tagged 🤖 next to human ones (9/39 on our sandbox
at time of writing). Detection, reporting, and future agent-specific dispute semantics: provable
today, on their rails, with zero PayPal changes.

## My agents — the buyer's oversight tab

`/oversight` is the buyer-side view PayPal's app would grow: per agent — spend captured, purchases,
**walls that held** (refusals by reason), what the agent remembers about you (journalled), every
mandate with its limits — and one **STOP** button that ends an agent's authority instantly
(revocation is journalled). Below it, the sealed-journal feed of everything the agents caused.
Grant → act under walls → oversee → stop: the full loop a buyer actually needs before delegating
money to software.

## Agent track record — refusals as reputation

`GET /api/agents/:agent/track-record` computes what an agent DID from the sealed chain — mandates
issued, purchases captured with exact spend, refusals honored by reason code — and signs a portable
statement committing to the chain tip. The honest core is structural: **the enforcer has no bypass
path**, so "this agent honors its walls" is accounting, not a promise. That signed statement is the
raw material of agent underwriting: merchants accept agents whose walls provably held; buyers
delegate to agents with a track record; PayPal — which cannot observe agent behavior — can own the
ledger of it.

## Agent memory (journalled)

The agent remembers its principal — tiers, trusted merchants, standing instructions — through
`save_preference` / `recall_preferences` (or `POST /api/agent/preferences`). Every change is a fact
landed in the sealed journal (old → new), so "why did the agent pick this?" stays auditable evidence,
not a vibe.

## Merchant dispute cockpit

`/dashboard` is the merchant-facing cockpit (AG Grid): disputes with their 10-day response
deadlines, the linked receipt for each agent purchase, and one-click **evidence packs** —
markdown or JSON — that bundle the signed mandate, the receipt, the verified journal chain and
the signed refusals proving enforcement was live. Submit goes through PayPal's
`provide-evidence` (sandbox); in mock mode the pack is real and downloadable, the submission is
refused honestly.

## LLM agent

```bash
OPENAI_API_KEY=... npm run demo:llm -- <mandate_id> "Buy a mechanical keyboard for under $60"
```

Works with any OpenAI-compatible endpoint (`OPENAI_BASE_URL`, `OPENAI_MODEL`). The agent's only
payment tools are `mandate_status`, `purchase` and `my_receipts` — all funnelled through the
enforcer.

## How verification works

A receipt is a signed bundle: the receipt, the mandate it was issued under, both Ed25519
signatures, and the journal events of the operation (`purchase_requested` → `order_created` →
`order_captured`). The verifier page re-hashes every event, checks both signatures, and confirms
the chain is intact at verification time. Refusals are signed the same way — *"the agent tried to
spend and was blocked, here is the proof"* is exactly as valuable as the receipt.

**Two lenses (v0.5):** `/verify/<id>` renders the same signed artifact two ways — a **Summary**
anyone can read (what happened, in plain sentences, what it means concretely) and **Full evidence**
(signatures, Merkle proof, journal events, raw bundle) for insurers and dispute handlers. Same bytes,
two audiences.

**Portable commitment (v0.3):** every receipt also carries a **Merkle inclusion proof**: the
capture event is provably committed by a **signed tree head** over the *whole* journal (Ed25519 by
the journal key). Anyone holding the bundle can recompute the proof offline — the receipt no
longer just claims "these events happened", it *commits* to the entire append-only history.
Scheme: CT-inspired padded Merkle tree, deliberately not RFC 6962 (documented in `src/journal/merkle.ts`).

Still honest: the tree head is signed by *our* journal key, so it proves internal consistency and
commitment. Proving *when* — to a third party, without trusting us — is the **RFC 3161 TSA anchor (v0.4)**:
each tree head is timestamped by an independent Timestamp Authority (freeTSA by default), the
request+token pair is journalled and served at `/api/journal/anchor.tsr` and `/api/journal/anchor.tsq`.
Any third party re-verifies with plain openssl — no trust in us, no code from us:

```
curl -o anchor.tsr http://localhost:8790/api/journal/anchor.tsr
curl -o anchor.tsq http://localhost:8790/api/journal/anchor.tsq
curl -O https://freetsa.org/files/cacert.pem -O https://freetsa.org/files/tsa.crt
openssl ts -verify -queryfile anchor.tsq -in anchor.tsr -CAfile cacert.pem -untrusted tsa.crt
# → Verification: OK
```

So the full chain of custody is now: **signed mandate → journalled intent/execution → Merkle
inclusion proof → signed tree head → TSA-sealed time**. A receipt proves not just what was spent,
but when it was provably already recorded.

## Built with the sponsors' stack

Every sponsor prize category is exercised in production, not sprinkled on:

| Sponsor | Where it lives in Carte Blanche |
|---|---|
| **AG Grid** | **AG Studio** (`/analytics`): the seller's self-serve dashboard over six tables (PayPal sales, disputes, agent receipts, refusals, mandates, health), two pre-built pages, a custom **Threshold KPI** widget (dispute rate vs PayPal's 1.5 %) and the **Studio Agent Framework** on our own LLM proxy with merchant prompt starters — plus the Resolution Center grid (`/dashboard`: live SSE feed into async row transactions, floating filters, quick filter, urgency row rules, CSV export), AG Charts, and the **journey grid** (`/planner`) filling with signed outcomes as the run goes |
| **Render** | The live demo is Render-native: Frankfurt web service, `/healthz` health checks, auto-deploy on commit, Blueprint (`render.yaml`) — including an hourly **cron job** that TSA-anchors the journal on demand (`POST /api/journal/anchor`), keeping the provable-WHEN continuous. Honest note: the free plan has no persistent disk, so the deployed journal lives per-deploy |
| **Channel3** | The agent's shopping scene (`/api/catalog`, **live key connected**): real search across 100M+ retail offers with **per-merchant price comparison** (offers sorted cheapest-first) — loading a cheaper unfamiliar offer into the purchase form is the drift story the mandate stops. The **Journey planner** (`/planner`) builds whole baskets from live catalog lines |
| **APIMatic** | The contract is **validated and linted by APIMatic's API** — `validation: OK, linting: OK (0 errors)` against their agentic-tools ruleset — and the **TypeScript SDK is generated and checked in** at [`sdk/typescript/`](sdk/typescript) (`npm run apimatic:sync` replays validate → generate → download against their REST API). Portal hosting lands when the APIMatic workspace is connected |
| **Bryntum** | The deadlines timeline (`/dashboard` → deadlines timeline): every dispute as an event from opened to respond-by, urgency-colored, refreshed live — the **TaskBoard** kanban (`/board`): Open → Under review → Waiting → Won/Lost — and the **journey execution board** (`/planner`): planned → purchased → refused, live as the run goes. One Bryntum bundle per page (their trial UMDs can't share a namespace) |

## Architecture

```
LLM agent ── tools ──►  Enforcer  ── mandate check ──►  PayPal REST (Orders v2)
                          │  │                            (deterministic PayPal-Request-Id)
        signed mandate ───┘  └── events ──►  Sealed journal (SHA-256 chain + signed checkpoints)
                                                │
                                     signed receipts / signed refusals ──► /verify/<id>
```

### Deployed on Render

The live demo runs on [Render](https://render.com) (Frankfurt, free plan):
`https://carte-blanche-6jgo.onrender.com` — health-checked on `/healthz`,
auto-deploying on every commit, infra-as-code via `render.yaml` (Blueprint).
Attach a disk at `/var/data/carte-blanche` to persist the sealed journal
across restarts; the TSA anchor endpoints stay publicly verifiable either way.

```
src/
  lib/        canonical JSON, Ed25519, keys, atomic JSON persistence
  mandate/    mandate schema + money math, signing, immutable store + revocation
  journal/    append-only hash chain, checkpoints, per-mandate spend aggregation
  paypal/     thin REST client (token cache, per-call request ids) + mock/sandbox rails
  enforcer/   the boundary: checks, idempotence, journalling, receipts & refusals
  receipts/   evidence bundles + verification reports
  agent/      tool schemas, OpenAI-compatible loop, scripted demo
  web/        console + public verification page (no framework, no build step)
```

## API

| Route | What |
|---|---|
| `POST /api/mandates` | grant a mandate (signed) |
| `GET /api/mandates` / `GET /api/mandates/:id` | list / detail (incl. captured spend) |
| `POST /api/mandates/:id/revoke` | revoke (immediate) |
| `POST /api/agent/purchase` | **the agent boundary** — receipt or signed refusal |
| `GET /api/receipts?mandate_id=` | receipts + refusals |
| `GET /dashboard` | merchant dispute cockpit (AG Grid) |
| `GET /analytics` | seller analytics — AG Studio dashboard + agents |
| `GET /board` | dispute workflow kanban (Bryntum TaskBoard) |
| `GET /api/disputes` | disputes (sandbox API, or labeled mock rows) |
| `GET /api/disputes/:id/evidence-pack` | evidence bundle (JSON + markdown) |
| `POST /api/disputes/:id/submit-evidence` | submit via PayPal `provide-evidence` |
| `GET /api/verify/:kind/:id` | full verification report |
| `GET /api/journal/verify` | chain integrity |
| `GET /healthz` | liveness + rails mode |
| `GET /llms.txt` | agent-readable API map (the llms.txt convention) |
| `GET/POST /api/agent/preferences` | the agent's journalled memory of its principal |

## Human-in-the-loop wallet purchases (v0.5)

Card-funded sandbox orders auto-capture; **wallet orders stop at `PAYER_ACTION_REQUIRED`** —
the buyer (a human) must approve. The enforcer journals the pending position
(`order_awaiting_buyer`) and returns the approval redirect; when the human agrees,
`resumePurchase()` replays the capture with the **same deterministic PayPal-Request-Id**
(PayPal idempotency makes the replay safe), journals the capture and issues the receipt.
The chain then spans the whole story — *mandate → intent → order → human approval → capture* —
which is exactly the human-approval hook PayPal's own agent toolkit lacks.

```
npm run wallet2:create        # journalled intent + order, prints the approval link
# ... the buyer clicks "Agree & Pay" at the link ...
npm run wallet2:watch -- --logical-key <key>   # capture + receipt when approved
```

## Security model (v0, stated plainly)

- Custodial by default (the server signs mandates with its own key) — but **non-custodial is live**: check "I keep the keys" and the mandate is signed in your browser with a WebCrypto Ed25519 key; the server only verifies. Both modes flow through identical enforcement and verification.
- Mandates are immutable; only revocation changes behavior, and revocations are journalled.
- Amounts are decimal strings compared in minor units (bigint) — no floats in the auth path.
- Keys live in `KEYS_DIR` (0600), state in `STATE_DIR`; both are gitignored.
- The journal detects any tampering (chain break) and **v0.3 receipts commit to the whole chain**
  via Merkle inclusion proofs against signed tree heads. **v0.4 seals the *when***: tree heads are
  RFC 3161-anchored by an independent TSA (freeTSA default, override with `TSA_URLS`); the
  request/token pair is journalled and verifiable with plain openssl (commands above).

## Roadmap

1. **S2 ✓** — merchant dispute cockpit (AG Grid + AG Charts): live dispute feed over server-sent events (async row transactions), floating filters, quick filter, deadline row highlighting, status/reason charts, CSV export, persisted column layout.
2. **S3 ✓** — exercised end-to-end against the live sandbox: wallet purchase → buyer dispute → API → evidence pack (see `npm run roundtrip:sandbox`).
   The merchant cockpit also ships a **Bryntum Calendar** view: every dispute becomes an event spanning opened → respond-by,
   colored by urgency (red ≤ 3 days) — the whole 10-day window at a glance, live from the SSE feed.
3. **S4a ✓** — Merkle inclusion proofs + signed tree heads on every receipt (portable commitment).
4. **S4b ✓** — RFC 3161 TSA anchoring of tree heads (`npm run anchor`; openssl-verified by third parties).
5. **S5 ✓** — principal-held keys: check **"I keep the keys"** in the console and the mandate is Ed25519-signed *in your browser* (WebCrypto) — the server verifies your signature and stores your public key, but never sees your private key and cannot forge the mandate. Enforcement and verification paths are unchanged: whoever holds the key, the walls hold.
6. **S6 ✓** — the seller's seat: Resolution Center with coverage matrix vs PayPal's evidence slots, FIGHT / REFUND FIRST, fast lane (real refunds), fulfillment slot with real shipment trackers, coverage-aware automation rules, dispute rate and deadline alerts; activation sealing (the buyer's words on the receipt); agent passports; the React back-office behind a real Connect-with-PayPal login.

**Next** — the pre-dispute webhook (our ask to PayPal: Resolution-Center pre-chargeback alerts
have no API event today), seller → buyer messaging through an API, shipping-label generation on
top of the trackers, buyer-side filing once the APIs open, and publishing `channel3-lite` and the
OpenAPI → MCP generator.

## Status

Built in the open for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com)
(Oct–Nov 2026). See [PROGRESSION.md](PROGRESSION.md) for the dated build log.

MIT — see [LICENSE](LICENSE).

## Sandbox end-to-end (real rails)

```bash
npm run roundtrip:sandbox        # mandate → real order+capture → dispute probe → evidence pack
npm run roundtrip:sandbox -- --dispute PP-D-…   # steps 3-5 against a buyer-opened dispute
```

Known PayPal sandbox limits, hit live on 2026-10-11 and documented rather than hidden:
card-funded orders auto-capture at creation (`ORDER_ALREADY_CAPTURED` — our rails layer
reconciles with the real capture instead of crashing: the double-spend trap absorbed where it
belongs); `POST /v1/customer/disputes` returns 500 on every schema-valid body (their bug — probe
log kept in `.state/dispute-probe.log`, debug_ids included). A buyer-opened dispute from the
sandbox Resolution Center completes the round-trip: pass its id with `--dispute`.

Render deploy: `python3 scripts/render-deploy.py` (API key at `~/.zcode/secrets/render-api.key`,
secrets from `.env`, never echoed).
