# Sponsor proposals — in their shoes

*Written 2026-10-14. The exercise: stop listing what we CONSUMED from each sponsor and answer the
sponsor's actual question — "why did my money go to this hackathon, and what did it buy me beyond
a tweet?" Sponsors don't buy advertising with prize money; they buy** pipeline**: adopters, content
that sells, feedback their product teams can act on, and proof their stack survives real use. Below,
per sponsor: what they actually need, what we already built that serves it, and what we propose to
hand them.*

---

## PayPal (the organizer)

**Their real objective, beyond com.** PayPal's agentic-commerce problem is not "can an agent pay?"
(their toolkit already does that) — it is **"can we let agents pay without owning the fallout?"**
Three fears drive their roadmap: agent fraud and runaway spending (who is liable when a model
escalates?), dispute chaos (a chargeback on an agent purchase has no evidence trail today), and
regulators asking how a card number ended up in a prompt. A sponsor keynote about agent payments is
a promise merchants will demand kept.

**What we already built that serves it.** The whole project IS PayPal's answer drafted in open
source: mandates signed by the principal, refusals as first-class signed evidence, a dispute
evidence pack, deterministic request ids (the double-spend trap), all on their Orders v2 rails —
plus the Amex Intent Intelligence pattern proven implementable on PayPal today, which turns a
competitor's keynote into a feature PayPal can ship without a card network.

**Why they organized this hackathon (the honest read).** Not cheaper R&D — cheaper *optionality
and outside eyes*. PayPal cannot publicly say "we don't know how to underwrite an agent"; a
hackathon lets 500 teams probe their rails and surface the missing primitives (ours found two:
no approval hooks, client-level idempotence = double-spend) at the price of two engineers, while
keeping every experiment running ON PayPal rails instead of a competitor's. The winning narrative
for them is inversion: agents paying via PayPal are **more** accountable than humans —
cryptographic intent plus sealed evidence beats behavioral vibes. Everything below feeds that.

**PayPal's products of tomorrow, prototyped today (no wheel reinvented — all on Orders v2 + Disputes):**

| Tomorrow's PayPal surface (plausible) | Prototyped in Carte Blanche |
|---|---|
| **PayPal Agent Mandates** — a spending-authority object the buyer signs, the agent presents, the rail verifies | `cb-mandate/v1`: immutable, revocable, Ed25519-signed — and since S5, signable **by the buyer's own browser key** (non-custodial) |
| **PayPal Agent Keys** — buyers hold their agent's spending key, PayPal only verifies | live today: "I keep the keys" in the console generates a WebCrypto keypair in the tab; the server verifies the signature and journals rejected forgeries |
| **Agent dispute category with evidence packs** — "my agent did it" needs its own dispute semantics and an evidence standard | evidence packs bundling the signed mandate, receipts, refusals and chain verification, wired to `provide-evidence` |
| **Agent spending statements** — a buyer-visible audit of everything their agent did | the sealed journal + public `/verify/:id` + the journalled agent memory |
| **"Agents are safer than humans" narrative** — crypto intent > behavioral signals | the drift demos: cheaper-elsewhere, over-cap, off-list, replay — each stopped by signed proof |
| **Agent reputation / underwriting** — PayPal cannot observe agent behavior, but it can OWN the ledger of walls honored | **signed agent track records** (`GET /api/agents/:agent/track-record`): purchases captured, spend, refusals honored by reason — computed from the sealed chain, signed, portable, third-party verifiable. The raw material of agent underwriting: merchants accept agents whose walls provably held; buyers delegate to agents with a track record. The deeper point: obedience here is *architectural* (the enforcer has no bypass path), so the reputation is not a promise — it is an accounting |

**What we propose to hand them.**
1. **The pattern document** — "Intent-scoped payments on PayPal rails": the 5-stage pattern, the
   refusal semantics, the evidence chain, written so a PayPal PM could turn it into a roadmap item.
   Already drafted across the README + `npm run demo:intent`; needs packaging.
2. **The MCP server** (`mcp/server.ts`) — agents everywhere can spend under PayPal mandates from
   Claude Desktop or any MCP client, with receipts. This positions PayPal rails as the *default
   safe rail for the agent ecosystem* rather than one SDK among many.
2b. **Non-custodial Agent Keys** (new, S5): the buyer's Ed25519 key lives in their browser; the
   platform verifies but cannot forge mandates. For PayPal this is the liability answer — the
   authority is provably the buyer's, not the middleware's.
3. **The evidence standard** — refusals-as-signed-proof + journalled agent memory is a proposal for
   what agent-payment *auditability* should mean. Free to adopt.

**The ask:** feedback from the disputes/risk team, and a nudge on which of the three they'd want
productized first.

---

## AG Grid

**Their real objective.** AG Grid does not win by downloads; it wins when an enterprise dev team
copies an example into a production dashboard and never leaves. Their sponsorship buys *deep,
technically credible integrations* their sales team can point at — fintech-flavored, live data,
real filtering — not to-do-app demos.

**What we already built.** A dispute cockpit that is honestly one of the more complex Community-mode
grids in the wild: SSE-driven async row transactions, floating + quick filters, urgency row rules,
persisted column state, pagination, CSV export, AG Charts — plus a second auto-generated grid in the
journey planner that fills with signed outcomes during a run.

**What we propose to hand them.**
1. **A public recipe**: "An agent-commerce dispute cockpit" — write-up + the exact grid config,
   transaction-diff pattern, and the row-rules-as-deadline technique. Candidate for their examples
   gallery or blog.
2. **`ag-grid-journey`**: extract our grid ⇄ execution-board binding (grid rows and a workflow board
   diffing through the same state) as a small MIT package with the journey planner as the demo.
3. **Feedback from production use**: we run Community mode; a documented list of where Enterprise
   (status bar, grouping, Excel) would matter in a merchant cockpit — useful input for their
   license-pitch deck, and an honest reason for them to grant us a hackathon license.

**The ask:** an Enterprise license for the hackathon window; a link from their examples page.

---

## Bryntum

**Their real objective.** Premium components live or die on *believable scenarios*. Their gallery
needs apps that look like work, not toys. And as a smaller shop, they feel integration friction
harder than AG Grid does — every gotcha we document saves their support queue real tickets.

**What we already built.** Three distinct integrations: the dispute deadlines timeline (Calendar),
the dispute workflow kanban (`/board`, TaskBoard), and the journey execution board (`/planner`,
TaskBoard) where the board updates as money actually moves. Plus a genuinely useful discovery,
pinned in our docs: **their trial UMD bundles silently refuse to register when two products share a
page** — the second bundle no-ops on the populated namespace.

**What we propose to hand them.**
1. **The UMD gotcha, written up as a contribution** — a short doc/issue with the symptom (silent
   no-op), the diagnosis path, and the one-product-per-page pattern. This is support-queue gold.
2. **Two gallery examples**: "dispute response kanban" and "journey execution board" — both are
   plausible selling scenarios (operations, logistics, approvals) once you strip the payments
   branding.
3. **Grid ⇄ board binding** (shared with the AG Grid proposal) — Bryntum + AG Grid playing well
   together is a pattern neither vendor documents.

**The ask:** pointers on submitting the examples; permission to use their screenshots in our
submission video.

---

## Render

**Their real objective.** Render converts developers at the "first serious deploy" moment. Their
sponsorship buys Blueprints in the wild and teams whose first production service is Render-native —
then disks, cron jobs, and paid instances follow.

**What we already built.** A Blueprint-defined service with health checks, plus usage of the deploy
API, env-var API, and (declared) a cron job — an unusual spread of the platform for a hackathon app.

**What we propose to hand them.**
1. **The Deploy-to-Render button** (already in our README) — our repo is a working Blueprint anyone
   can fork-deploy in one click, free-tier-safe.
2. **A template submission**: Carte Blanche as a Render Blueprint template ("AI agent payments with
   an audit trail") — the anchor cron job is the natural upsell path to a paid plan.
3. **The honest failure story**: the repo-going-private broke Render's GitHub binding and silently
   froze deploys — we diagnosed it through their API and documented the recovery. That's a support
   article they could publish.

**The ask:** a look at our Blueprint from their solutions team; template-gallery inclusion.

---

## Channel3

**Their real objective.** A young API wins on *integrated demos* and *response-shape feedback from
real consumers*. Every app that pins their prices into something critical (a signed mandate!) is
proof their data is production-grade; every shape complaint is free product research.

**What we already built.** Live integration with real keys, mapped onto their TRUE response shape
(price objects, domain merchants, affiliate buy links, ratings — all documented in our mapper and
pinned by a test), multi-merchant offer comparison sorted cheapest-first, and prices flowing into
signed mandates and journey baskets.

**What we propose to hand them.**
1. **`channel3-lite`** — extract our typed client (transport, real-shape mapping, offer sorting,
   sample fallback) as a small MIT package other agent builders can use in ten lines.
2. **The drift-detection pattern**: their per-merchant offers + our allowlist = "cheaper elsewhere"
   as a fraud/oversight signal. A write-up their content team could reuse.
3. **Shape feedback**: field-by-field notes from a strict consumer (e.g. merchant naming consistency,
   `compare_at_price` handling) — the kind of report their API team actually wants.

**The ask:** a backlink/integration listing; direct line to their API team for the shape notes.

---

## APIMatic

**Their real objective.** APIMatic sells the moment an API team asks "how do we get SDKs and docs
without maintaining them?" Their sponsorship buys specs that survive their pipeline and teams that
adopt docs-as-code.

**What we already built.** Our contract passes their validation AND their agentic-tools linting
(0 errors), a generated TypeScript SDK committed in-repo, and `npm run apimatic:sync` — the full
docs-as-code loop against their REST API, including their vendor content-types and auth scheme
(extracted from their own SDK).

**What we propose to hand them.**
1. **A showcase spec**: authored APIMatic-first (descriptions, examples per endpoint, lint-clean) —
   a template other hackathon teams and API teams can copy.
2. **The sync script as a docs-as-code example** — theirs is a paid workflow; ours is a working
   100-line reference implementation against their platform API.
3. **Two bug reports already in hand**: `/api-entities/import-*` returning bare 500s, and their
   egress fetcher failing on some public URLs.

**The ask:** developer-portal workspace connection so the hosted portal URL goes live; review of
the sync script by their platform team.

---

## The thread tying it together

Every proposal above is the same move: **we used the sponsor's product where it bites — prices in
signed mandates, grids in dispute ops, boards over real executions, a spec judged by an agent
linter — and we hand back the artifact a sponsor's own team would have to write anyway.** Not a
thank-you slide; a pull request-shaped gift.
