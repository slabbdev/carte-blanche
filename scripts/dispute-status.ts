import { loadEnvFile } from "../src/lib/env.js";
import { makePayPalClient } from "../src/paypal/adapter.js";

/** Dispute lookup: npx tsx scripts/dispute-status.ts <PP-D-or-PP-R-id> [--list] */
async function main(): Promise<void> {
  loadEnvFile();
  const client = makePayPalClient(process.env)!;
  const arg = process.argv[2];

  if (arg === "--list" || !arg) {
    const all = await client.listDisputes();
    const items = (all.data as { items?: Array<Record<string, unknown>> }).items ?? [];
    console.log(`disputes on the merchant account: ${items.length}`);
    for (const d of items) {
      console.log(`  ${d.dispute_id} · ${d.status} · ${d.reason}`);
    }
    if (items.length === 0) console.log("  (sandbox merchant sees no dispute yet)");
    return;
  }

  const res = await client.getDispute(arg);
  if (!res.ok) {
    console.log(`HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
    return;
  }
  const d = res.data as Record<string, unknown>;
  console.log(`dispute : ${d.dispute_id}`);
  console.log(`status  : ${d.status} · stage: ${d.dispute_life_cycle_stage ?? "?"}`);
  console.log(`reason  : ${d.reason}`);
  const txs = (d.disputed_transactions ?? []) as Array<Record<string, unknown>>;
  for (const t of txs) console.log(`  tx: seller=${t.seller_transaction_id ?? "?"} buyer=${t.buyer_transaction_id ?? "?"}`);
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
