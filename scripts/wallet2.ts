import { loadEnvFile } from "../src/lib/env.js";

loadEnvFile();

/**
 * Two-phase wallet purchase — the human-in-the-loop demo:
 *   npm run wallet2:create  → journals intent + order, prints the approval link
 *   npm run wallet2:watch   → polls the resume endpoint until the receipt lands
 * The buyer (a human) clicks "Agree & Pay" at the link in between.
 */

const BASE = process.env.CB_URL ?? "http://127.0.0.1:8790";

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && json.error) throw new Error(String(json.error));
  return json;
}

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function ensureMandate(): Promise<{ mandateId: string }> {
  const data = await api("/api/mandates", {
    method: "POST",
    body: JSON.stringify({
      principal: "demo-principal",
      agent: "demo-agent",
      purpose: "two-phase wallet demo",
      currency: "USD",
      max_per_transaction: "30.00",
      max_total_spend: "60.00",
      window_hours: 24,
    }),
  });
  return { mandateId: String(data.mandate_id ?? data.mandateId ?? "") };
}

async function main(): Promise<void> {
  const logicalKey = flag("logical-key");
  if (logicalKey) {
    // step 2: poll until the buyer has approved at the redirect
    console.log(`resuming ${logicalKey} — waiting for the buyer to approve…`);
    for (let i = 0; i < 120; i++) {
      try {
        const done = await api("/api/agent/purchase/resume", {
          method: "POST",
          body: JSON.stringify({ logical_key: logicalKey }),
        });
        if (done.outcome === "receipt") {
          const receiptId = String((done.receipt as Record<string, unknown> | undefined)?.receiptId ?? done.receipt_id ?? "?");
          console.log(`RECEIPT ${receiptId} — fully journalled, TSA-anchorable, dispute-ready`);
          console.log(`verify at ${BASE}/verify/${receiptId}`);
          return;
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (!/not approved|pending/i.test(msg)) throw e;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error("timed out waiting for buyer approval");
  }

  // step 1: create the pending order through the enforcer
  const amount = flag("amount") ?? "15.00";
  const mandateId = flag("mandate") ?? (await ensureMandate()).mandateId;
  const res = await api("/api/agent/purchase", {
    method: "POST",
    body: JSON.stringify({
      mandate_id: mandateId,
      amount,
      currency: "USD",
      description: flag("desc") ?? "two-phase wallet demo purchase",
    }),
  });
  if (res.outcome !== "pending") {
    console.log("purchase was not pending — outcome:", JSON.stringify(res).slice(0, 300));
    return;
  }
  const key = String(res.logicalKey ?? res.logical_key ?? "");
  console.log(`order ${String(res.orderId)} is journalled and awaiting the buyer`);
  console.log(`👉 approve here (buyer): ${String(res.approvalUrl)}`);
  console.log(`then: npm run wallet2:watch -- --logical-key ${key}`);
}

await main();
