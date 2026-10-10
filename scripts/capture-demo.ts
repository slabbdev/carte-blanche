import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { signMandate } from "../src/mandate/signing.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "../src/receipts/receipts.js";

/**
 * Records the exact scenario the GitHub Pages explainer replays:
 * real signatures, real journal, real refusals — captured once and shipped as
 * static evidence in docs/assets/artifacts.json. Only the PUBLIC key ships;
 * the signing key is generated here and thrown away with the temp dir.
 *
 *   npx tsx scripts/capture-demo.ts
 */
async function main(): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-capture-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);

  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "Sam",
    agent: "shopping-agent-1",
    purpose: "team snacks this week",
    limits: {
      currency: "USD",
      maxPerTransaction: "30.00",
      maxTotalSpend: "60.00",
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));

  const run = async (logicalKey: string, amount: string, description: string, payee?: string) =>
    enforcer.purchase({ mandateId: mandate.id, amount, currency: "USD", description, payee, logicalKey });

  const out: Record<string, unknown> = {};

  out["demo-1-coffee"] = await run("demo-1-coffee", "25.00", "coffee beans for the team");
  out["demo-2-mat"] = await run("demo-2-mat", "30.00", "standing desk mat");
  out["demo-3-over-cap"] = await run("demo-3-over-cap", "25.00", "another bag of coffee beans");
  out["demo-4-over-tx"] = await run("demo-4-over-tx", "500.00", "flight to Las Vegas");

  store.revoke(mandate.id, "principal cut the card");
  journal.append("mandate_revoked", { mandate_id: mandate.id, reason: "principal cut the card" });
  out["demo-5-after-revoke"] = await run("demo-5-after-revoke", "5.00", "post-revocation attempt");

  // sanity: everything we ship must verify
  for (const [k, o] of Object.entries(out)) {
    const kind = (o as { kind: string }).kind;
    const report = kind === "receipt" ? verifyFullReceipt((o as { full: never }).full) : verifyFullDenial((o as { full: never }).full);
    if (!report.overall) throw new Error(`artifact ${k} failed verification`);
    console.log(`ok ${k}: ${kind} verified`);
  }
  const chain = journal.verify();
  if (!chain.ok) throw new Error("journal chain broken at capture time");

  const artifact = {
    meta: {
      project: "carte-blanche",
      version: "0.1.0",
      capturedAt: new Date().toISOString(),
      rails: "mock",
      note: "Byte-for-byte record of a real run (scripts/capture-demo.ts). Signatures are real Ed25519 over canonical JSON; the signing key was discarded after capture — only this public key remains.",
      genesis: "sha256:carte-blanche/journal/genesis/v1",
      chainLength: chain.length,
      chainTip: chain.tip,
    },
    publicKey: keys.server.publicKeyB64,
    mandate: store.get(mandate.id),
    events: journal.recent(chain.length).reverse(),
    outcomes: out,
  };

  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "assets", "artifacts.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(artifact, null, 2));
  console.log(`\nwrote ${target} (${chain.length} events, tip ${chain.tip.slice(0, 16)}…)`);
  console.log(`temp state discarded: ${stateDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
