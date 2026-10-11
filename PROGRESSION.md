# Build log

Dated log of what changed and when. The hackathon submission window opened 2026-10-01;
everything from 2026-10-10 onward is work performed inside the window.

| Date | What |
|---|---|
| 2026-10-10 | Market/technical recon: agentic-commerce gap analysis across PayPal APIs, Stripe ACP, Google AP2, x402 (`RECON` notes kept out of repo). Decision: build the missing trust layer on PayPal rails. |
| 2026-10-10 | Project skeleton: mandate schema + Ed25519 signing (canonical JSON), immutable mandate store with revocation, sealed append-only journal (SHA-256 chain + signed checkpoints), enforcer with per-operation deterministic `PayPal-Request-Id`, signed receipts **and signed refusals**, mock/sandbox rails behind one interface, Express API, console + public verification page, scripted demo, OpenAI-compatible agent loop. Test suite: mandates/crypto, journal (incl. tamper detection + torn-line recovery), enforcer (all refusal paths, idempotence, restart durability), PayPal client (header propagation, token cache). |
| 2026-10-10 | Interactive explainer published on GitHub Pages (`docs/`, source `main`): replay of a recorded run with real Ed25519 artifacts (`scripts/capture-demo.ts` → `docs/assets/artifacts.json`; signing key discarded after capture), in-browser verification via WebCrypto (SHA-256 chain re-hash + Ed25519 signature checks). |
| 2026-10-10 | v0.2.0 — merchant dispute cockpit (S2): `/dashboard` with AG Grid 36 (dark theming), dispute rows with 10-day response deadlines and linked receipts; evidence packs generated from the sealed journal (mandate signature + receipt + chain verification + signed refusals) as JSON and markdown; `provide-evidence` submission path (real in sandbox, honestly refused in mock); sandbox SAMPLE-dispute seeding endpoint; 9 new tests (37 total). |
| 2026-10-11 | v0.3.0 — portable commitment (S4a): padded CT-inspired Merkle tree over the journal (`src/journal/merkle.ts`, deliberately not RFC 6962 — documented), signed tree heads cached per size, inclusion proof of the capture event embedded in every full receipt, verified in the verification report; exhaustive tests (all leaf indices for sizes 1–40, tamper/wrong-root/wrong-index rejections, root instability under reordering, STH signature + growth). |
