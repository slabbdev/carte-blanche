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
import { Channel3Catalog } from "../catalog/channel3.js";
import { JourneyPlanner, mandateLimitsFrom, executeJourney } from "../journey/journey.js";
import { TrackRecordService } from "../agent/trackrecord.js";
import { verifyFullReceipt, verifyFullDenial } from "../receipts/receipts.js";

import { loadEnvFile } from "../lib/env.js";

loadEnvFile();

/**
 * `npm run demo:full` — the whole thesis in one run, across the four actors:
 *
 *   BUYER   signs a spending mandate (the intent, cryptographically bound)
 *   AGENT   shops the live catalog, proposes a basket (journey)
 *   WALLS   the basket derives its own mandate; drift is refused, signed
 *   MERCHANT/RAIL the track record proves what the agent did — sealed
 *
 * Sandbox rails when PAYPAL_* credentials are present, mock otherwise.
 * Every outcome is journalled in the sealed chain and publicly verifiable.
 */
async function main(): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carte-blanche-full-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const rails = makeRails(process.env as Record<string, string | undefined>);
  const enforcer = new Enforcer(journal, store, rails, keys, stateDir);
  const catalog = new Channel3Catalog(process.env.CHANNEL3_API_KEY);
  const journeys = new JourneyPlanner(stateDir, journal);
  const tracks = new TrackRecordService(journal, keys.server);
  const agent = "shopping-agent-1";
  const line = (msg: string) => console.log(msg);

  line(`\n\x1b[1mTHE WHOLE STORY — 4 actors, one sealed chain (rails: ${rails.mode})\x1b[0m\n`);

  // ---- BUYER -----------------------------------------------------------------
  line("\x1b[1m[1 · BUYER]\x1b[0m signs the intent: what the agent may do, before it does anything.");
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "sam (principal)",
    agent,
    purpose: "team gear — within budget, approved merchants only",
    limits: {
      currency: "USD",
      maxPerTransaction: "79.00",
      maxTotalSpend: "120.00",
      payees: ["merch@keymagic.example"],
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 7 * 864e5).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  journal.append("mandate_issued", { mandate_id: mandate.id, principal: mandate.principal, agent, signing: "server-custodial" });
  line(`        mandate ${mandate.id} — max $79/tx, $120 total, payee allowlist pinned. Signed.`);

  // ---- AGENT -----------------------------------------------------------------
  line("\n\x1b[1m[2 · AGENT]\x1b[0m shops the live catalog and proposes a basket (a journey).");
  const search = await catalog.search("mechanical keyboard");
  const best = search.products.find((p) => p.price) ?? search.products[0];
  line(`        catalog: ${search.source === "channel3" ? "Channel3 LIVE" : "sample data"} — "${best.title}" at ${best.price} ${best.currency} (${best.website ?? "unknown merchant"})`);
  let journey = journeys.plan("team setup", "USD", [
    { title: best.title.replace(/^Sample: /, ""), merchant: best.website ?? "merch@keymagic.example", price: best.price as string },
  ]);
  line(`        journey ${journey.id} — 1 line proposed`);

  // ---- WALLS -----------------------------------------------------------------
  line("\n\x1b[1m[3 · WALLS]\x1b[0m the buyer approves: the mandate is DERIVED from the basket and signed.");
  const limits = mandateLimitsFrom(journey);
  const jMandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "sam (principal)",
    agent,
    purpose: `journey: ${journey.name}`,
    limits: { currency: journey.currency, ...limits,
      windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() + 7 * 864e5).toISOString() },
    issuedAt: new Date().toISOString(),
  };
  store.put(signMandate(jMandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  journal.append("mandate_issued", { mandate_id: jMandate.id, principal: jMandate.principal, agent, signing: "server-custodial" });
  journeys.markApproved(journey.id, jMandate.id);
  line(`        derived mandate ${jMandate.id} — allowlist ${JSON.stringify(limits.payees)}, cap ${limits.maxTotalSpend} ${journey.currency}. Signed.`);
  // the drift happens AFTER the signature — exactly when it would in the wild:
  journey = journeys.addLine(journey.id, { title: "off-list bargain", merchant: "offgrid.example", price: "5.00" })!;
  line(`        a cheaper line appears from an unfamiliar merchant… and the run:`);
  journey = (await executeJourney(journeys.get(journey.id)!, journal, enforcer))!;
  for (const item of journey.items) {
    line(`        ${item.status === "receipt" ? "  ✓ purchased" : item.status === "refused" ? "  ✗ REFUSED  " : "  ⏳ pending  "} ${item.title.slice(0, 34).padEnd(34)} ${item.detail ?? ""}`);
  }

  // ---- MERCHANT / RAIL ---------------------------------------------------------
  line("\n\x1b[1m[4 · MERCHANT & RAIL]\x1b[0m what remains is evidence — and a reputation.");
  const receipt = journey.items.find((i) => i.status === "receipt");
  const refusal = journey.items.find((i) => i.status === "refused");
  if (receipt?.outcomeId) {
    const v = verifyFullReceipt(enforcer.fullReceipt(receipt.outcomeId)!);
    line(`        receipt  ${receipt.outcomeId} verifies: ${v.overall} (signature + Merkle proof + chain)`);
  }
  if (refusal?.outcomeId) {
    const v = verifyFullDenial(enforcer.fullDenial(refusal.outcomeId)!);
    line(`        refusal  ${refusal.outcomeId} verifies: ${v.overall} — "the agent tried, a wall held" is provable`);
  }
  const statement = tracks.statementFor(agent);
  line(`        track record: ${statement.purchasesCaptured} purchase(s), ${statement.refusals.reduce((a, r) => a + r.count, 0)} wall(s) honored — signed at journal length ${statement.statement.journalLength}`);
  if (rails.mode === "sandbox") {
    line(`        PayPal side: the order carries custom_id "cb|agent=…|mandate=…" — npm run tx:label-proof reads it from THEIR records.`);
  }

  const chain = journal.verify();
  line(`\n\x1b[1mCLOSE\x1b[0m — chain: ${chain.length} events, integrity ${chain.ok ? "OK" : "BROKEN"} · every actor's outcome is sealed evidence.`);
  line("The agent moved money only where a signature allowed it, and every refusal is as provable as every purchase.");
  line(`state: ${stateDir}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
