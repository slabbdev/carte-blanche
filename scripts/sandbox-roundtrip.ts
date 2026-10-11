import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "../src/lib/env.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { signMandate } from "../src/mandate/signing.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { makeRails, makePayPalClient } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";
import { DisputeService } from "../src/disputes/service.js";
import { buildEvidencePack, toMarkdown, toProvideEvidenceEntries } from "../src/disputes/evidence.js";
import { verifyFullReceipt } from "../src/receipts/receipts.js";

/**
 * THE round-trip, against real PayPal SANDBOX rails (Merchant app):
 *   mandate → purchase (order + capture) → SAMPLE dispute on our capture
 *   → evidence pack generated from the sealed journal → provide-evidence
 *   → dispute status after submission.
 *
 *   npm run roundtrip:sandbox        (reads .env; PAYPAL_MODE=sandbox required)
 */
const step = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);
const info = (msg: string) => console.log(`   ${msg}`);

async function main(): Promise<void> {
  loadEnvFile();
  if (process.env.PAYPAL_MODE !== "sandbox") {
    throw new Error("PAYPAL_MODE=sandbox required (this script hits the real sandbox API)");
  }
  const keys = loadOrCreateKeys(process.env.KEYS_DIR ?? ".keys");
  const stateDir = process.env.STATE_DIR ?? ".state";
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const rails = makeRails(process.env);
  const enforcer = new Enforcer(journal, store, rails, keys, stateDir);
  const client = makePayPalClient(process.env)!;
  const disputes = new DisputeService({ railsMode: rails.mode, client, enforcer, journal });
  info(`rails: ${rails.mode} · journal: ${journal.length} events`);

  // 1) mandate + real purchase (test-card candidates: PayPal rejects unsupported BINs per account)
if (!process.argv.includes('--dispute')) {
  step("1 · Mandate + real sandbox purchase (order → capture)");
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "Sam (sandbox principal)",
    agent: "roundtrip-agent-1",
    purpose: "S3 round-trip against real sandbox rails",
    limits: {
      currency: "USD",
      maxPerTransaction: "30.00",
      maxTotalSpend: "60.00",
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));

  const CARD_CANDIDATES = ["4111111111111111", "4005519200000004", "5555555555554444"];
  let purchase: Awaited<ReturnType<Enforcer["purchase"]>> | undefined;
  for (const card of CARD_CANDIDATES) {
    process.env.PAYPAL_SANDBOX_CARD_NUMBER = card;
    const railsAttempt = makeRails(process.env);
    const attempt = new Enforcer(journal, store, railsAttempt, keys, stateDir);
    try {
      purchase = await attempt.purchase({
        mandateId: mandate.id,
        amount: "25.00",
        currency: "USD",
        description: "S3 round-trip purchase (sandbox test card)",
        logicalKey: `rt-${card}-${Date.now()}`,
      });
      info(`funded with sandbox card ending ${card.slice(-4)}`);
      break;
    } catch (e) {
      const msg = String((e as Error).message);
      if (/card\/number|VALIDATION_ERROR/.test(msg)) {
        info(`card ••••${card.slice(-4)} rejected, trying next candidate…`);
        continue;
      }
      throw e;
    }
  }
  if (!purchase) throw new Error("all sandbox test cards rejected");
  if (purchase.kind !== "receipt") throw new Error(`purchase refused: ${purchase.denial.reasonCode} — ${purchase.denial.reasonDetail}`);
  const report = verifyFullReceipt(purchase.full);
  info(`order ${purchase.receipt.orderId} → capture ${purchase.receipt.captureId} (${purchase.receipt.status})`);
  info(`receipt ${purchase.receipt.receiptId} · verification: ${report.overall ? "ALL CHECKS PASS" : "FAIL"} · inclusion root ${purchase.full.inclusion?.treeHead.root.slice(0, 12)}…`);

}
  // 2) a dispute on OUR capture. PayPal documents SAMPLE disputes for sandbox,
  // but their create-dispute backend currently 500s on every well-formed body.
  // Probe variants are logged to the state dir; the honest path forward is a
  // real buyer-opened dispute passed via --dispute.
  step("2 · Dispute on the capture");
  const argDispute = process.argv[process.argv.indexOf("--dispute") + 1];
  let disputeId: string | undefined = argDispute && /^(PP-D|PP-R)/.test(argDispute) ? argDispute : undefined;
  if (disputeId) {
    info(`using existing dispute ${disputeId} (passed via --dispute)`);
  } else {
    const probes: string[] = [];
    let created: { ok: boolean; detail: string; disputeId?: string } | undefined;
    for (const reason of ["MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "ITEM_NOT_RECEIVED", "ITEM_NOT_AS_DESCRIBED"]) {
      for (const txId of [purchase.receipt.captureId, purchase.receipt.orderId]) {
        created = await disputes.createSample({ transactionId: txId, reason, note: "carte-blanche S3 round-trip" });
        probes.push(`reason=${reason} tx=${txId} → ${created.detail}`);
        if (created.ok) break;
      }
      if (created?.ok) break;
    }
    if (created?.ok) {
      disputeId = created.disputeId;
      info(`dispute ${disputeId} filed against capture ${purchase.receipt.captureId}`);
    } else {
      try {
        fs.writeFileSync(path.join(stateDir, "dispute-probe.log"), probes.join("\n") + "\n");
      } catch { /* state dir may not exist yet — probes stay in memory */ }
      console.log(`   dispute creation: sandbox endpoint unavailable in this account (probe log: ${path.join(stateDir, "dispute-probe.log")})`);
      console.log(`   next: open a buyer dispute on capture ${purchase.receipt.captureId} (sandbox Resolution Center),`);
      console.log(`   then: npm run roundtrip:sandbox -- --dispute PP-D-…   — steps 3-5 then run for real.`);
    }
  }

  const view = (disputeId && (await disputes.list()).find((d) => d.disputeId === disputeId))
    ?? (disputeId ? await disputes.get(disputeId) : undefined);
  if (!disputeId || !view) {
    step("3-5 · Pack preview (builds from the real capture)");
    const pack = buildEvidencePack(
      { disputeId: "preview", reason: "ITEM_NOT_RECEIVED", status: "preview", source: "paypal" },
      { enforcer, journal, store, keys },
    );
    const file = `./${pack.packId}.md`;
    fs.writeFileSync(file, toMarkdown(pack));
    info(`pack ${pack.packId} · chain ${pack.chain.ok ? "OK" : "BROKEN"} · ${pack.enforcement.signedRefusals.length} signed refusals on mandate → ${file}`);
    return;
  }

  // 3) evidence pack from the sealed journal
  step("3 · Evidence pack generated from the sealed journal");
  const pack = buildEvidencePack(view, { enforcer, journal, store, keys });
  info(`pack ${pack.packId} · chain: ${pack.chain.ok ? "OK" : "BROKEN"} · ${pack.enforcement.signedRefusals.length} signed refusals on mandate`);
  fs.writeFileSync(`./${pack.packId}.md`, toMarkdown(pack));
  info(`markdown written to ./${pack.packId}.md`);

  // 4) submit evidence — the call the official agent toolkit doesn't even expose
  step("4 · provide-evidence (the call the official toolkit never exposes)");
  const entries = toProvideEvidenceEntries(pack);
  let submitted = await disputes.submitEvidence(disputeId, entries, toMarkdown(pack));
  if (!submitted.ok && /evidence_type/i.test(submitted.detail)) {
    info("evidence_type rejected — retrying with PROOF_OF_PAYMENT shape…");
    submitted = await disputes.submitEvidence(
      disputeId,
      [{ evidence_type: "PROOF_OF_PAYMENT", items: [{ notes: toMarkdown(pack) }] }],
      toMarkdown(pack),
    );
  }
  info(submitted.ok ? "✓ evidence submitted" : `submission result: ${submitted.detail.slice(0, 300)}`);

  // 5) status after
  step("5 · Dispute status after evidence submission");
  const after = await client.getDispute(disputeId);
  const data = after.data as { status?: string; dispute_life_cycle_stage?: string };
  info(`status=${data.status ?? "?"} · stage=${data.dispute_life_cycle_stage ?? "?"}`);
  const scope = process.argv.includes("--dispute")
    ? `dispute ${disputeId}`
    : `mandate ${mandate.id} · capture ${purchase.receipt.captureId} · dispute ${disputeId}`;
  console.log(`\nDONE — ${scope}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
