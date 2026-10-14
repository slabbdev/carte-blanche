# AP2 alignment — Carte Blanche as the working prototype of PayPal's own roadmap

PayPal's AP2 post ("PayPal and the Agent Payments Protocol", developer blog, Sept 2025) states the
vision and — verbatim — the gaps. This document maps each stated gap to the Carte Blanche artifact
that already fills it, on PayPal rails, today. Vocabulary note: an AP2 **Intent Mandate**
("the user pre-approves defined conditions — budget, categories, timing — that authorize an agent
to act later") is a Carte Blanche **mandate**; an AP2 **Cart Mandate** ("the merchant signs the
cart, the user signs to approve it") is an approved **journey**; an AP2 **Payment Mandate** ("a
minimal credential derived from a Cart or Intent Mandate") is the signed mandate the enforcer
executes against.

| PayPal's stated gap (their words) | Carte Blanche artifact (shipped) | Where |
|---|---|---|
| "Current dispute workflows lack cryptographic proof" | Signed receipts AND signed refusals, Merkle inclusion proofs, RFC 3161 TSA anchoring | `/api/verify/:kind/:id`, `/verify/:id` (public, no account) |
| Mandates "could add cryptographic artifacts that can be validated independently" | Every artifact verifies offline via WebCrypto — the public explainer and `/verify` re-hash the chain in the browser | `docs/index.html`, `src/web/verify.html` |
| "Resolution today rests on logs and chargebacks" | One-click evidence packs: signed mandate + receipt + refusal history + chain verification, wired to PayPal `provide-evidence` | `/dashboard`, `/api/disputes/:id/evidence-pack` |
| Accountability "tied to real-world entities… not the agent" | **Non-custodial mandates**: the principal's browser key signs; the platform verifies and cannot forge | "I keep the keys" in the console (S5) |
| Enforcement of intent "before money moves" | The enforcer: every mutative call checked against the signed mandate pre-capture; deterministic request ids (no double-spend) | `src/enforcer/enforcer.ts` |
| Separating "agentic vs. non-agentic traffic" | `custom_id = "cb\|agent=…\|mandate=…"` on PayPal's own order records; detectable via their Transaction Search | `npm run tx:label-proof` (9/39 sandbox transactions tagged) |
| "APIs and adapters for mandate creation and storage" | Full REST API + MCP server (13 tools) + `/llms.txt` agent map | `/openapi.json` (APIMatic-validated), `mcp/server.ts` |
| AP2 Cart Mandate ("merchant signs, user signs") | Journeys: the basket derives its mandate, the human approves, drift after signature is refused with signed proof | `/planner`, `POST /api/journeys/:id/approve\|run` |
| Intent Mandate conditions (budget, categories, timing) | Mandate limits: per-transaction cap, total cap, currency, payee allowlist, time window | `cb-mandate/v1`, immutable + revocable |
| Trust model beyond "curated allow-lists" | Signed agent track records — reputation as accounting (the enforcer has no bypass path) | `GET /api/agents/:agent/track-record` |

## The one-line thesis

AP2 defines what agent payments should be — verifiable, auditable, interoperable. Agent Ready
makes them possible. **Carte Blanche is the enforcement-and-evidence layer that makes them true:
every "could" in the AP2 roadmap is a "does" here, open source, on PayPal rails, proven in a
single command (`npm run demo:full`).**

## What we ask from PayPal

1. Review the mandate format against AP2's Verifiable Credential encoding — we will adopt it.
2. Tell us which of the mapped artifacts they want first-class in Agent Ready (we contribute the
   pattern and the code).
3. Disputes: pilot the agent-purchase evidence pack in `provide-evidence` with us.
