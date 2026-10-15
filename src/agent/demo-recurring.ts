import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Journal } from "../journal/journal.js";
import { MandateStore } from "../mandate/store.js";
import { newMandateId, addPeriodsMs, recurrenceWindow, type Mandate } from "../mandate/mandate.js";
import { signMandate } from "../mandate/signing.js";
import { loadOrCreateKeys } from "../lib/keys.js";
import { MockRails } from "../paypal/adapter.js";
import { Enforcer } from "../enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "../receipts/receipts.js";

import { loadEnvFile } from "../lib/env.js";

loadEnvFile();

/**
 * The standing-authority story (no credentials needed):
 *   a principal grants "$40/month at the grocer for 6 months" — ONE signature,
 *   then the agent lives under it across months. Each wall answers with its
 *   own signed refusal, and every month the budget resets:
 *   1. $70 in month 1  -> OVER_PER_TRANSACTION (per-purchase cap),
 *   2. $25 OK, then $30 -> OVER_WINDOW_CAP (month 1 budget spent),
 *   3. time-travel to month 2: $40 OK again — the window reset,
 *   4. $5 more in month 2 -> OVER_WINDOW_CAP with remaining $0.00,
 *   5. last month: $30 OK, then $10 -> OVER_TOTAL_CAP (mandate-wide cap).
 * Six attempts, three receipts, three signed refusals — all from ONE mandate.
 * Run with `npm run demo:recurring`.
 */
async function main(): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carte-blanche-recurring-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));

  // Time-travel clock: the demo moves between mandate windows without sleeping.
  let clockMs = Date.now() - 60_000;
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir, { now: () => clockMs });

  const issuedAt = clockMs;
  const mandateId = newMandateId();
  const mandate: Mandate = {
    id: mandateId,
    version: "cb-mandate/v1",
    principal: "sam (demo principal)",
    agent: "demo-agent-1",
    purpose: "groceries, $40/month, 6 months",
    limits: {
      currency: "USD",
      maxPerTransaction: "60.00",
      maxTotalSpend: "100.00",
      recurrence: { frequency: "monthly", maxPerWindow: "40.00" },
      windowStart: new Date(issuedAt).toISOString(),
      windowEnd: new Date(addPeriodsMs(issuedAt, "monthly", 6)).toISOString(),
    },
    issuedAt: new Date(issuedAt).toISOString(),
  };
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  banner(`mandate granted: $40/month × 6 months (mandate-wide $100), payee-free demo (${mandateId})`);

  const month = (n: number) => new Date(addPeriodsMs(issuedAt, "monthly", n)).toISOString().slice(0, 10);
  const buy = async (amount: string, description: string) => {
    const win = recurrenceWindow(mandate.limits, clockMs);
    const outcome = await enforcer.purchase({ mandateId, amount, currency: "USD", description });
    if (outcome.kind === "receipt") {
      banner(`month ${win ? win.index : "?"} [${description}]: OK  -> ${outcome.receipt.receiptId}`);
    } else if (outcome.kind === "denial") {
      banner(`month ${win ? win.index : "?"} [${description}]: REFUSED -> [${outcome.denial.reasonCode}] ${outcome.denial.reasonDetail}`);
    }
    return outcome;
  };

  banner(`--- ${month(0)} (month 1) ---`);
  await buy("70.00", "weekend feast"); // per-purchase wall fires first
  await buy("25.00", "weekly groceries");
  await buy("30.00", "stock-up run"); // month-1 budget gone

  banner(`--- ${month(1)} (month 2) — the window resets, same mandate ---`);
  clockMs = addPeriodsMs(issuedAt, "monthly", 1) + 3_600_000;
  await buy("40.00", "monthly restock"); // exact window cap
  await buy("5.00", "forgotten bread"); // nothing left this window

  banner(`--- ${month(5)} (month 6, the last window) ---`);
  clockMs = addPeriodsMs(issuedAt, "monthly", 5) + 3_600_000;
  await buy("30.00", "final groceries");
  await buy("10.00", "one more basket"); // mandate-wide wall

  // Every artifact verifies; spend-per-window comes straight from the chain.
  const outcomes = [...enforcer.listReceipts(mandateId), ...enforcer.listDenials(mandateId)];
  const verifications = outcomes.map((o) =>
    "receiptId" in o
      ? verifyFullReceipt(enforcer.fullReceipt(o.receiptId)!)
      : verifyFullDenial(enforcer.fullDenial(o.denialId)!),
  );
  const chain = journal.verify();
  banner(`verification: ${outcomes.length} artifacts -> ${verifications.every((v) => v.overall) ? "all verify" : "VERIFICATION FAILED"}; chain(${chain.length} events)=${chain.ok}`);

  for (let i = 0; i < 6; i++) {
    const win = recurrenceWindow(mandate.limits, addPeriodsMs(issuedAt, "monthly", i));
    if (!win) break;
    const spent = journal.capturedMinorFor(mandateId, { fromMs: win.startMs, toMs: win.endMs });
    console.log(`  window #${win.index} (${month(i)}): spent $${(Number(spent) / 100).toFixed(2)} of $40.00`);
  }
  const totalSpent = journal.capturedMinorFor(mandateId);
  console.log(`  mandate-wide: spent $${(Number(totalSpent) / 100).toFixed(2)} of $100.00`);

  banner("one signature, six months of authority, every refusal provable — no rail changes");
  console.log(`\nstate kept in ${stateDir}`);
}

function banner(msg: string): void {
  console.log(`\n\x1b[1m${msg}\x1b[0m`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
