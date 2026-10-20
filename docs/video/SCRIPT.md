# Carte Blanche — Devpost video (v2, React back-office) — 1:16, EN

**Pipeline (fully automated):** `npx tsx scripts/record-video.ts` records the 7 scene takes on
the running instance (Playwright, 1440×900; `CB_SESSION_COOKIE` = a local test session), the
voiceovers are `say -v Samantha -r 185` (texts below, `docs/video/vo2/`), title/end cards are
browser-rendered PNGs (`cards/`), `./docs/video/assemble.sh` cuts each take to its VO and concatenates.
Output: `docs/video/carte-blanche-demo.mp4` (v1, pre-React: `carte-blanche-demo-v1.mp4`).

| # | Scene | Take | VO |
|---|---|---|---|
| 1 | Hook — the refusal | console: 45.00 against a 30.00 cap → REFUSED OVER_PER_TRANSACTION, signed proof link | Give an AI agent a payment tool, and you hand it a blank check. At Carte Blanche, a forty-five dollar attempt against a thirty dollar cap does not get an error. It gets signed proof. |
| 2 | Grant | console: grant form → Grant mandate | Authority is a document, not a prompt. The mandate is Ed25519-signed and immutable: per-transaction cap, total cap, revocable in one click. |
| 3 | Sealed activation | console: "buy me two USB-C cables, max 25 dollars" → Acheter maintenant → RECEIPT + steps + "your words are sealed" | Type what you want, and a budget. The agent shops the live catalog, buys the best offer under the mandate, and your exact words are sealed into the receipt. That is the seller's answer to: "I never told my agent that." |
| 4 | The seller | /dashboard → case drawer: REFUND FIRST, coverage, fast lane, Contacter l'acheteur, evidence pack | On the seller's side, every case is scored against PayPal's real evidence slots: fight or refund first, a fast-lane refund, an amicable message, and the evidence pack, submitted to PayPal in one click. |
| 5 | AG Studio | /analytics: Threshold KPI tiles, charts, agent prompt starters | Sellers also get AG Studio: dashboards over PayPal's own records and the evidence layer — dispute rate against PayPal's 1.5 % threshold, walls that held, and agents that build widgets from a sentence, running on our server, never the browser. |
| 6 | Verify | /verify | Every receipt and refusal verifies publicly: signatures, Merkle proof, no account. |
| 7 | Close | console | PayPal's tools. Your rules. Signed evidence. Carte Blanche — agentic commerce you can audit. |

Rules check: < 3 min ✓ · shows the project functioning ✓ · no third-party music ✓ · PayPal's name
in nominative use only, no PayPal logo assets (the PayPal button is their own SDK) ✓. Upload to
YouTube (public) and paste the link in the Devpost form.

---

## v1 script (pre-React, kept for reference)

# Carte Blanche — Devpost video script (< 3 min, EN)

Target: 2:45 runtime. Full-screen screencast, minimal on-screen captions (the
wording below doubles as burned-in captions), voiceover per scene. Recording
plan at the bottom. Every number shown is real (sandbox receipts from 2026-10-11).

---

## Scene 1 — THE HOOK (0:00–0:22)

Screen: black → the refusal lands (console, red refusal card with reason code).

VO:
> AI agents are starting to spend money. But if you give an agent a PayPal
> account, you're handing it a blank check — the official toolkit has no
> spending limits, no approval hooks, no human in the loop.

Caption: "Your agent. Your money. No limits."

## Scene 2 — WHAT WE BUILT (0:22–0:40)

Screen: console — create a mandate form (cap 30, total 60, USD, window 24h) →
"Grant mandate" → signature pill visible.

VO:
> Carte Blanche is the trust layer for agentic payments on PayPal rails.
> You grant your agent a **signed spending mandate** — Ed25519, immutable,
> capped per transaction and in total, revocable at any time.

Caption: "Ed25519-signed mandate · immutable · revocable"

## Scene 3 — THE REFUSAL IS A PROOF (0:40–1:05)

Screen: same console, agent attempts 45.00 against the 30.00 cap → signed
refusal card: OVER_PER_TRANSACTION + "verify" link.

VO:
> When the agent tries to spend beyond the mandate, it doesn't just get
> blocked — it gets a **signed proof of refusal**. Every refusal is evidence,
> timestamped and tamper-evident. In a world of autonomous agents, "no" needs
> a paper trail too.

Caption: "signed refusal = evidence, not an error"

## Scene 4 — HUMAN IN THE LOOP (1:05–1:40)

Screen: two-phase wallet purchase — order created, "awaiting buyer" state in
the journal, approval link opens PayPal checkout, human clicks Agree & Pay,
watcher captures, receipt lands.

VO:
> For wallet payments there's a second phase the official toolkit skips:
> a human. The order journals itself as *awaiting buyer*, you approve at
> PayPal, and the capture replays with the same deterministic request id —
> so the human approval is part of the chain, not a workaround.

Caption: "mandate → intent → order → human approval → capture"

## Scene 5 — THE RECEIPT COMMITS TO EVERYTHING (1:40–2:10)

Screen: /verify/rcpt-… page → 6/6 checks green; scroll to the Merkle proof;
then the terminal: `npm run anchor` + `openssl ts -verify …` → Verification: OK.

VO:
> Every receipt carries a Merkle inclusion proof against the whole sealed
> journal — and the tree head is anchored by an independent timestamp
> authority. That's the openssl one-liner any third party can run against
> the journal without trusting us. Verification: OK.

Caption: "notarized, not claimed"

## Scene 6 — THE MERCHANT SIDE (2:10–2:35)

Screen: /dashboard — live feed badge, dispute row (10d left, orange), click →
evidence pack generated from the journal (markdown preview), charts.

VO:
> When a dispute lands, the merchant cockpit assembles the evidence pack
> from the sealed journal — mandate, receipt, chain, Merkle proof, the works —
> in seconds. Deadlines are live, and the pack is verifiable end to end.

Caption: "dispute → dossier in seconds"

## Scene 7 — CLOSE (2:35–2:45)

Screen: repo page (license MIT visible) + live URL.

VO:
> Carte Blanche. The trust layer AP2 envisions — shipping today, on PayPal
> rails. Try it live; the repo runs in one command.

Caption: "github.com/slabbdev/carte-blanche · carte-blanche.onrender.com"

---

## Recording plan (automated)

| # | Scene | Capture method | State needed |
|---|-------|----------------|--------------|
| 1+3 | hook + refusal | browser recording, localhost console | mandate exists (cap 30) |
| 2 | grant | browser recording, console form | none |
| 4 | two-phase | browser recording ×2 + Sam's one click at the approval link | sandbox buyer logged in |
| 5 | verify + anchor | browser recording + terminal script (asciinema-style) | anchor command run live |
| 6 | cockpit | browser recording, /dashboard live feed | the real PP-R dispute exists |
| 7 | close | static screen captures | none |

Voiceover: `say -v <EN voice>` per scene, or Sam reads the script.
Editor: ffmpeg concat + 1.2s crossfades + captions burned from the VO lines.
