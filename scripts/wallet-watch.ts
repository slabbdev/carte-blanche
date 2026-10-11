import { loadEnvFile } from "../src/lib/env.js";
import { makePayPalClient } from "../src/paypal/adapter.js";

/**
 * Watches a wallet order until the buyer approves, then captures.
 *   npx tsx scripts/wallet-watch.ts <order_id>
 */
async function main(): Promise<void> {
  loadEnvFile();
  const client = makePayPalClient(process.env)!;
  const orderId = process.argv[2];
  if (!orderId) throw new Error("usage: npx tsx scripts/wallet-watch.ts <order_id>");

  const deadline = Date.now() + 20 * 60_000;
  let status = "UNKNOWN";
  while (Date.now() < deadline) {
    const res = await client.getOrder(orderId);
    status = res.ok ? res.data.status : "?";
    process.stdout.write(`${status} · `);
    if (status === "APPROVED" || status === "COMPLETED") break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("");

  if (status === "COMPLETED") {
    const res = await client.getOrder(orderId);
    const capture = res.data.purchase_units?.[0]?.payments?.captures?.[0];
    console.log(`already captured: ${capture?.id} (${capture?.status})`);
    return;
  }
  if (status !== "APPROVED") {
    console.log("not approved in time — nothing captured.");
    process.exit(0);
  }

  const captured = await client.captureOrder(orderId, `wallet-watch-${orderId}`);
  const capture = captured.ok ? captured.data.purchase_units?.[0]?.payments?.captures?.[0] : undefined;
  if (!capture) throw new Error(`capture failed: ${JSON.stringify(captured.data).slice(0, 300)}`);
  console.log(`\n✓ capture ${capture.id} — ${capture.status}`);
  console.log("\nNext: Activity → the 15.00 EUR payment → Resolution Center → dispute (item not received) → paste the PP-D-… back.");
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
