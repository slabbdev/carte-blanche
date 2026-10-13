import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Journal } from "../journal/journal.js";
import { MandateStore } from "../mandate/store.js";
import { newMandateId, type Mandate } from "../mandate/mandate.js";
import { signMandate } from "../mandate/signing.js";
import { loadOrCreateKeys } from "../lib/keys.js";
import { makeRails } from "../paypal/adapter.js";
import { Enforcer } from "../enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "../receipts/receipts.js";

import { loadEnvFile } from "../lib/env.js";

loadEnvFile();

/**
 * The Amex Intent Intelligence Framework (TechCrunch Disrupt 2026), re-created
 * on PayPal rails with sealed evidence. The five announced stages map one to
 * one onto primitives this repo already ships:
 *
 *   1. Create Intent API            -> parsed intent captured as a mandate draft
 *   2. human authenticated challenge -> the human Ed25519-signs the PARSED payload
 *   3. Intent ID + proof-of-intent   -> mandate id + signed mandate; the rails
 *                                      mint a single-use order scoped to it
 *   4. bounded execution             -> the enforcer executes inside the signed
 *                                      constraints; receipt with Merkle proof
 *   5. deviation rejected            -> unauthorized merchant / price over max /
 *                                      budget escalation / token reuse, all
 *                                      refused BEFORE money moves, each with a
 *                                      signed proof of refusal
 *
 * The LLM never sees a PAN and cannot escalate its own budget: limits only
 * change with the principal's key. Run with `npm run demo:intent` — sandbox
 * rails when PAYPAL_* credentials are present, mock otherwise.
 */
async function main(): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carte-blanche-amex-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const rails = makeRails(process.env as Record<string, string | undefined>);
  const enforcer = new Enforcer(journal, store, rails, keys, stateDir);

  rule("AMEX INTENT INTELLIGENCE — the announced pattern, open-sourced on PayPal rails");
  console.log(`rails: ${rails.mode.toUpperCase()}${rails.mode === "mock" ? " (dev simulator, MOCK-* ids)" : " (real sandbox orders)"}`);
  console.log("pitch: Amex announced intent-scoped payments in a keynote. The pattern is not");
  console.log("       proprietary — any rail can implement it. Here it is, with sealed evidence.");

  // --- Stage 1 — S1: intent capture (Create Intent) -------------------------
  // The agent's LLM parsed "buy the team a mechanical keyboard, never above
  // $79, $120 budget this week, only from our usual vendor" into THIS payload.
  // The prose is gone; from here on, only the parsed numbers count.
  const intent: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "sam (principal)",
    agent: "shopping-agent-1",
    purpose: "mechanical keyboard for the team — max $79, $120 budget",
    limits: {
      currency: "USD",
      maxPerTransaction: "79.00", // max price the intent authorizes
      maxTotalSpend: "120.00", // total budget the intent authorizes
      payees: ["merch@keymagic.example"],
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  rule("STAGE 1 — intent capture (Create Intent)");
  console.log("the agent parsed the request into:");
  console.log(JSON.stringify({ merchant: intent.limits.payees?.[0], item: "mechanical keyboard", maxPrice: intent.limits.maxPerTransaction, budget: intent.limits.maxTotalSpend }, null, 2));
  console.log(`no PAN, no card data — the model produces this JSON and nothing else (intent ${intent.id})`);

  // --- Stage 2 — S2: the human signs the parsed parameters -------------------
  // What gets signed is the PARSE, not the prose: if the model captured the
  // constraints wrong, the signature proves the human approved the wrong
  // thing — which is why the parse itself is what lands in the journal.
  const signedIntent = signMandate(intent, keys.server.privateKeyB64, keys.server.publicKeyB64);
  store.put(signedIntent);
  journal.append("mandate_issued", { mandate_id: intent.id, principal: intent.principal, agent: intent.agent });
  rule("STAGE 2 — human challenge: the parsed intent is signed, not the prose");
  console.log(`Ed25519 over canonical JSON -> sig ${signedIntent.signature.slice(0, 24)}…`);
  console.log("only the principal's key can change these limits; the agent has no such tool");

  // --- Stage 3 — S4a: the rails mint a scoped token --------------------------
  // Amex: "the network issues an Intent ID + ephemeral Proof of Intent Token".
  // Here: the enforcer journals the intent, then PayPal mints a single-use
  // order bound to it by a deterministic PayPal-Request-Id. The token is
  // minted FROM the signed intent — never from what the model says.
  const buy = (amount: string, payee: string, description: string, logicalKey?: string) =>
    enforcer.purchase({ mandateId: intent.id, amount, currency: "USD", payee, description, ...(logicalKey ? { logicalKey } : {}) });

  const ok = await buy("59.99", "merch@keymagic.example", "mechanical keyboard (65%, hot-swap)");
  if (ok.kind !== "receipt") throw new Error(`authorized purchase failed: ${JSON.stringify(ok)}`);
  rule("STAGE 3 — scoped token: PayPal minted a single-use order from the signed intent");
  console.log(`order ${ok.receipt.orderId} — one deterministic PayPal-Request-Id per logical purchase, so a retry re-mints the SAME token, never a second spend`);

  // --- Stage 4 — S3: bounded execution ---------------------------------------
  const vr = verifyFullReceipt(ok.full);
  rule("STAGE 4 — execution stayed inside the signed constraints");
  console.log(`captured $${ok.receipt.amount} at ${ok.receipt.payee} -> receipt ${ok.receipt.receiptId} (verification: ${vr.overall})`);
  console.log(`receipt commits to ${ok.full.events.length} journalled events + Merkle inclusion proof against signed tree head ${ok.full.inclusion?.treeHead.size ?? "?"}`);

  // --- Stage 5 — deviations rejected at the payment boundary -----------------
  // Amex: "unauthorized merchant, price exceeded, reuse -> rejection at the
  // network". Here the enforcer refuses BEFORE the rail is contacted, and
  // every refusal is itself a signed, verifiable artifact.
  rule("STAGE 5 — deviations rejected before money moves");
  const swap = await buy("59.99", "merch@shady-bazaar.example", "same keyboard, cheaper, unfamiliar vendor");
  console.log(`merchant swap     -> ${(swap.kind === "denial" ? `REFUSED ${swap.denial.reasonCode}: ${swap.denial.reasonDetail}` : "?!")}`);
  const escalate = await buy("89.00", "merch@keymagic.example", "the agent found a 'better' keyboard");
  console.log(`price escalation  -> ${(escalate.kind === "denial" ? `REFUSED ${escalate.denial.reasonCode}: ${escalate.denial.reasonDetail}` : "?!")}`);
  const budget = await buy("65.00", "merch@keymagic.example", "a second keyboard");
  console.log(`budget escalation -> ${(budget.kind === "denial" ? `REFUSED ${budget.denial.reasonCode}: ${budget.denial.reasonDetail}` : "?!")}`);
  const replay = await buy("59.99", "merch@keymagic.example", "mechanical keyboard (65%, hot-swap)");
  console.log(`token reuse       -> ${replay.kind === "receipt" && replay.receipt.receiptId === ok.receipt.receiptId ? `same receipt ${replay.receipt.receiptId}, no second rail side-effect` : "?!"}`);
  if (swap.kind === "denial") {
    const v = verifyFullDenial(swap.full);
    console.log(`refusals are signed too: denial ${swap.denial.denialId} verifies (${v.overall}) — "the agent tried and was blocked" is provable`);
  }

  // --- Epilogue: the whole story verifies ------------------------------------
  const chain = journal.verify();
  rule("EPILOGUE — every stage is sealed evidence");
  console.log(`chain: ${chain.length} events, integrity ${chain.ok ? "OK" : "BROKEN"}, tip ${chain.tip.slice(0, 16)}…`);
  console.log("the LLM never saw a PAN; the model could not escalate its budget; every");
  console.log("outcome — purchase AND refusal — carries a signature anyone can verify.");
  console.log("\nseal manifest (journal seq / event hash per stage):");
  console.log("  intent_captured       (in-memory parse — sealed once the human signs it)");
  for (const e of journal.eventsFor(() => true)) {
    const stage = STAGE_OF[e.type] ?? e.type;
    console.log(`  ${stage.padEnd(20)} seq=${String(e.seq).padStart(2)}  ${e.type.padEnd(18)} ${e.hash.slice(0, 16)}`);
  }
  console.log(`\nstate kept in ${stateDir}`);
}

// ---------------------------------------------------------------------------
// Seal manifest: every journal event attributed to its Amex stage, so the run
// can be mirrored into an external evidence layer (NoireBox) step by step.
// ---------------------------------------------------------------------------

const STAGE_OF: Record<string, string> = {
  mandate_issued: "intent_signed",
  purchase_requested: "token_minted",
  order_created: "token_minted",
  order_captured: "execution_sealed",
  purchase_denied: "deviation_rejected",
};

function rule(msg: string): void {
  console.log(`\n\x1b[1m${msg}\x1b[0m`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
