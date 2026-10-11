import { loadEnvFile } from "../src/lib/env.js";
import { makePayPalClient } from "../src/paypal/adapter.js";

/** One-shot probe: which create-dispute body shape does the sandbox accept? */
async function main(): Promise<void> {
  loadEnvFile();
  const client = makePayPalClient(process.env)!;
  const txId = process.argv[2];
  if (!txId) throw new Error("usage: npx tsx scripts/probe-dispute-create.ts <capture_or_order_id>");

  const bodies: Array<[string, Record<string, unknown>]> = [
    ["clean: tx + reason", { disputed_transaction: { transaction_id: txId }, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" }],
    ["clean + note", { disputed_transaction: { transaction_id: txId, note: "probe" }, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" }],
    ["lowercase reason", { disputed_transaction: { transaction_id: txId }, reason: "merchandise_or_service_not_received" }],
    ["UNAUTHORISED_TRANSACTION", { disputed_transaction: { transaction_id: txId }, reason: "UNAUTHORISED_TRANSACTION" }],
    ["UNAUTHORIZED_TRANSACTION", { disputed_transaction: { transaction_id: txId }, reason: "UNAUTHORIZED_TRANSACTION" }],
    ["ITEM_NOT_RECEIVED (list-style)", { disputed_transaction: { transaction_id: txId }, reason: "ITEM_NOT_RECEIVED" }],
  ];
  for (const [label, body] of bodies) {
    const res = await client.createSampleDisputeBody(body as never);
    const summary = res.ok
      ? `OK dispute_id=${(res.data as { dispute_id?: string }).dispute_id}`
      : `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`;
    console.log(`${res.ok ? "✓" : "✗"} ${label} → ${summary}`);
    if (res.ok) break;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
