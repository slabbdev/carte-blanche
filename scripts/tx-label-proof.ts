import { loadEnvFile } from "../src/lib/env.js";

loadEnvFile();

import { makePayPalClient } from "../src/paypal/adapter.js";

/**
 * `npm run tx:label-proof` — the agent-purchase DETECTION proof, PayPal-side.
 *
 * PayPal cannot tell an agent purchase from a human one. Carte Blanche stamps
 * every order it mediates with an agent marker (custom_id ->
 * `cb|agent=...|mandate=...`), which SURVIVES into PayPal's own transaction
 * records. This script reads PayPal's Transaction Search API and shows the
 * marker on their side — retroactive, third-party-verifiable agent detection
 * with zero PayPal changes.
 */
const client = makePayPalClient(process.env as Record<string, string | undefined>);
if (!client) {
  console.error("PayPal credentials required (PAYPAL_MODE != mock with client id/secret)");
  process.exit(1);
}

const end = new Date();
const start = new Date(Date.now() - 7 * 864e5);
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const res = await client.listTransactions(iso(start), iso(end));
if (!res.ok) {
  console.error(`Transaction Search failed (HTTP ${res.status}):`, JSON.stringify(res.data).slice(0, 300));
  process.exit(1);
}
const txs = res.data.transaction_details ?? [];
console.log(`PayPal Transaction Search — ${txs.length} transaction(s) in the last 7 days\n`);
let labeled = 0;
for (const t of txs) {
  const info = t.transaction_info ?? {};
  const field = info.custom_field ?? "";
  const isAgent = field.startsWith("cb|") || field.startsWith("carte-blanche/");
  if (isAgent) labeled++;
  console.log(
    `${isAgent ? "🤖 AGENT" : "   human"} | ${(info.transaction_initiation_date ?? "").slice(0, 16)} | ` +
    `${(info.transaction_amount?.value ?? "?")} ${(info.transaction_amount?.currency_code ?? "")} | ` +
    `${info.transaction_status ?? "?"} | ${info.transaction_id ?? "?"}` +
    (field ? ` | custom: ${field}` : ""),
  );
}
console.log(`\n=> ${labeled}/${txs.length} transactions carry a Carte Blanche agent marker on PAYPAL's own records.`);
console.log("   (Transaction Search: GET /v1/reporting/transactions — no PayPal changes needed for detection.)");
