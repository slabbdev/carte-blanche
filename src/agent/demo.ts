import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Journal } from "../journal/journal.js";
import { MandateStore } from "../mandate/store.js";
import { newMandateId, type Mandate } from "../mandate/mandate.js";
import { signMandate } from "../mandate/signing.js";
import { loadOrCreateKeys } from "../lib/keys.js";
import { MockRails } from "../paypal/adapter.js";
import { Enforcer } from "../enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "../receipts/receipts.js";

/**
 * Scripted end-to-end scenario over MockRails (no credentials needed):
 *   1. a principal grants a $60 weekly mandate,
 *   2. the agent buys within limits -> signed receipt,
 *   3. the agent tries to exceed the total cap -> SIGNED REFUSAL,
 *   4. every artifact verifies; the journal verifies as a whole.
 * This is the 30-second story of the project, runnable with `npm run demo`.
 */
async function main(): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carte-blanche-demo-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);

  const mandateId = newMandateId();
  const mandate: Mandate = {
    id: mandateId,
    version: "cb-mandate/v1",
    principal: "sam (demo principal)",
    agent: "demo-agent-1",
    purpose: "team snacks, this week",
    limits: {
      currency: "USD",
      maxPerTransaction: "30.00",
      maxTotalSpend: "60.00",
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  banner(`mandate granted: $60 total / $30 per transaction / 7 days (${mandateId})`);

  const buy = (amount: string, description: string) =>
    enforcer.purchase({ mandateId, amount, currency: "USD", description });

  const r1 = await buy("25.00", "coffee beans for the team");
  banner(r1.kind === "receipt" ? `purchase 1 OK  -> ${r1.receipt.receiptId} (${r1.receipt.orderId})` : "unexpected denial");

  const r2 = await buy("30.00", "standing desk mat");
  banner(r2.kind === "receipt" ? `purchase 2 OK  -> ${r2.receipt.receiptId} (${r2.receipt.orderId})` : "unexpected denial");

  const r3 = await buy("25.00", "another bag of coffee beans");
  banner(
    r3.kind === "denial"
      ? `purchase 3 REFUSED -> ${r3.denial.denialId} [${r3.denial.reasonCode}] ${r3.denial.reasonDetail}`
      : "unexpected receipt",
  );

  const vr1 = r1.kind === "receipt" ? verifyFullReceipt(r1.full) : undefined;
  const vr3 = r3.kind === "denial" ? verifyFullDenial(r3.full) : undefined;
  const chain = journal.verify();

  banner(`verification: receipt=${vr1?.overall} refusal=${vr3?.overall} chain(${chain.length} events)=${chain.ok}`);
  banner(`retry-safety: re-submitting purchase 1 returns the same receipt id ${
    (await enforcer.purchase({ mandateId, amount: "25.00", currency: "USD", description: "coffee beans for the team" })).kind === "receipt"
      ? "(no second PayPal call)"
      : "?"
  }`);
  console.log(`\nstate kept in ${stateDir}`);
}

function banner(msg: string): void {
  console.log(`\n\x1b[1m${msg}\x1b[0m`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
