# Build log

Dated log of what changed and when. The hackathon submission window opened 2026-10-01;
everything from 2026-10-10 onward is work performed inside the window.

| Date | What |
|---|---|
| 2026-10-10 | Market/technical recon: agentic-commerce gap analysis across PayPal APIs, Stripe ACP, Google AP2, x402 (`RECON` notes kept out of repo). Decision: build the missing trust layer on PayPal rails. |
| 2026-10-10 | Project skeleton: mandate schema + Ed25519 signing (canonical JSON), immutable mandate store with revocation, sealed append-only journal (SHA-256 chain + signed checkpoints), enforcer with per-operation deterministic `PayPal-Request-Id`, signed receipts **and signed refusals**, mock/sandbox rails behind one interface, Express API, console + public verification page, scripted demo, OpenAI-compatible agent loop. Test suite: mandates/crypto, journal (incl. tamper detection + torn-line recovery), enforcer (all refusal paths, idempotence, restart durability), PayPal client (header propagation, token cache). |
