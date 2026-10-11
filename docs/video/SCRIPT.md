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
