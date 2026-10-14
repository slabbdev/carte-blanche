# Carte Blanche

**Your agent shops. You keep the keys.**

Spending mandates, sealed receipts and dispute-proof audits for AI agents paying with **PayPal**.

**▶ Interactive explainer with real signed artifacts: https://slabbdev.github.io/carte-blanche/**
(it replays a recorded run — press the buttons, watch refusals get signed, then verify everything
in your own browser with WebCrypto. Recorded by `scripts/capture-demo.ts`, served from `docs/`.)

**▶ Live app on Render (PayPal sandbox rails): https://carte-blanche-6jgo.onrender.com** — grant a
mandate, spend as the agent, watch a real sandbox order get captured, then verify the receipt at
`/verify/<id>`. Free instance: the first hit after ~15 min idle takes ~50 s to wake.

An AI agent with a payment tool is a walking blank check — today's toolkits will capture an order
because the model decided to. Carte Blanche is the layer that sits between the agent and PayPal:

- **Mandates** — the principal grants a signed, immutable spending mandate (per-transaction cap,
  cumulative cap, currency, payee allowlist, time window). Revocation is instant and the only exit.
- **Enforcement** — every mutative call is checked against the mandate *before* money moves,
  executed with a deterministic `PayPal-Request-Id` (a retry can never double-spend), and answered
  with a signed receipt — or a **signed proof of refusal** naming the limit that blocked it.
- **Sealed journal** — every event lands in an append-only SHA-256 chain with signed checkpoints.
- **Public verification** — anyone holding a receipt or refusal id can verify all signatures and
  the journal at `/verify/<id>`, no account needed. Built to become the evidence pack a merchant
  submits in a PayPal dispute (roadmap).

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

## Quickstart (no credentials needed)

```bash
npm install
npm run build
npm start          # rails: mock — clearly labeled MOCK-* ids
# open http://localhost:8790
```

The console lets you grant a mandate, act as the agent, and try to exceed the mandate.
Every outcome links to its public verification page.

End-to-end scripted scenario (30 seconds, no server needed):

```bash
npm run demo
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
| **AG Grid** | The merchant dispute cockpit (`/dashboard`): live SSE feed into async row transactions, floating filters, quick filter, urgency row rules, pagination, CSV export, persisted column state — plus AG Charts for disputes-by-status and amount-by-reason, and the **journey grid** (`/planner`): the basket's table auto-generated from its lines, filling with signed outcomes as the run goes |
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
| `GET /board` | dispute workflow kanban (Bryntum TaskBoard) |
| `GET /api/disputes` | disputes (sandbox API, or labeled mock rows) |
| `GET /api/disputes/:id/evidence-pack` | evidence bundle (JSON + markdown) |
| `POST /api/disputes/:id/submit-evidence` | submit via PayPal `provide-evidence` |
| `GET /api/verify/:kind/:id` | full verification report |
| `GET /api/journal/verify` | chain integrity |
| `GET /healthz` | liveness + rails mode |

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

- The server acts as **custodial principal** (it signs mandates with its own key). Non-custodial
  signing (principal-held keys, browser wallet) is on the roadmap.
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
5. **S5** — principal-held keys (non-custodial mandates), AP2/VC-style mandate format.

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
