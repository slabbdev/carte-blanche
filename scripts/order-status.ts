import { loadEnvFile } from "../src/lib/env.js";
import { makePayPalClient } from "../src/paypal/adapter.js";

/** Prints an order's live status + approval link: npx tsx scripts/order-status.ts <id> */
async function main(): Promise<void> {
  loadEnvFile();
  const client = makePayPalClient(process.env)!;
  const orderId = process.argv[2];
  if (!orderId) throw new Error("usage: npx tsx scripts/order-status.ts <order_id>");
  const res = await client.getOrder(orderId);
  if (!res.ok) throw new Error(`getOrder failed: ${JSON.stringify(res.data).slice(0, 300)}`);
  console.log(`order   : ${res.data.id}`);
  console.log(`status  : ${res.data.status}`);
  console.log(`intent  : ${(res.data as { intent?: string }).intent}`);
  const payer = (res.data as { payer?: { email_address?: string } }).payer;
  console.log(`payer   : ${payer?.email_address ?? "(not yet shown — buyer has not approved)"}`);
  for (const l of (res.data as { links?: Array<{ rel: string; href: string }> }).links ?? []) {
    console.log(`  ${l.rel.padEnd(14)} ${l.href.slice(0, 100)}`);
  }
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
