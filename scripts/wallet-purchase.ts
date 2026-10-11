import { loadEnvFile } from "../src/lib/env.js";
import { makePayPalClient } from "../src/paypal/adapter.js";

/**
 * Creates a WALLET-funded sandbox order (the only kind a buyer can dispute),
 * prints the approval link, waits for the buyer to approve, then captures.
 *
 *   npm run wallet:purchase          # 15.00 EUR, polls up to 15 min
 *
 * Buyer flow: open the printed link while logged in as the sandbox personal
 * account, click Agree & Pay. The script detects APPROVED and captures.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const client = makePayPalClient(process.env)!;
  if (!client) throw new Error("sandbox creds required");

  const amount = process.argv[2] ?? "15.00";
  const currency = process.argv[3] ?? "EUR";
  const logical = `wallet-${Date.now()}`;

  const created = await client.createOrder({
    amount,
    currency,
    description: "Carte Blanche wallet purchase (dispute round-trip)",
    requestId: logical,
    paymentSource: {
      paypal: {
        experience_context: {
          brand_name: "Carte Blanche Sandbox",
          user_action: "PAY_NOW",
          payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
        },
      },
    },
  });
  if (!created.ok) throw new Error(`createOrder failed: ${JSON.stringify(created.data).slice(0, 400)}`);
  const orderId = created.data.id;
  const links = (created.data as { links?: Array<{ rel: string; href: string }> }).links ?? [];
  const approve = links.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;

  console.log(`\norder   : ${orderId} (${amount} ${currency}, wallet-funded)`);
  if (!approve) throw new Error("no approve link in create response");
  console.log(`\n\x1b[1m👉 Open this link and click Agree & Pay (you are already logged in):\x1b[0m\n${approve}\n`);

  process.stdout.write("waiting for approval ");
  const deadline = Date.now() + 15 * 60_000;
  let status = "CREATED";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const order = await client.getOrder(orderId);
    status = order.ok ? order.data.status : "?";
    process.stdout.write(".");
    if (status !== "CREATED" && status !== "PAYER_ACTION_REQUIRED") break;
  }
  console.log(`\norder status: ${status}`);
  if (status !== "APPROVED") {
    console.log("not approved in time — rerun when ready. Nothing captured.");
    process.exit(0);
  }

  const captured = await client.captureOrder(orderId, `${logical}-cap`);
  const capture = captured.ok
    ? captured.data.purchase_units?.[0]?.payments?.captures?.[0]
    : undefined;
  if (!capture) throw new Error(`capture failed: ${JSON.stringify(captured.data).slice(0, 300)}`);
  console.log(`\n✓ capture ${capture.id} — ${capture.status}`);
  console.log(`\nNext: Centre de résolution (Resolution Center) → dispute THIS transaction`);
  console.log(`(item not received) → paste the PP-D-… id back to the round-trip:`);
  console.log(`  npm run roundtrip:sandbox -- --dispute PP-D-XXXXXXXX`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
