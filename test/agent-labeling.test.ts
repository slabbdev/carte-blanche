import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PayPalClient } from "../src/paypal/client.js";
import { LiveRails } from "../src/paypal/adapter.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { Enforcer } from "../src/enforcer/enforcer.js";

const TOKEN = { access_token: "tok", expires_in: 3600 };
const ORDER = { id: "ORDER-X", status: "CREATED" };
const CAPTURED = { id: "ORDER-X", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP-X", status: "COMPLETED" }] } }] };

function fetchMock(bodies: Array<{ status: number; body: unknown }>) {
  const bodiesSeen: unknown[] = [];
  let i = 0;
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : "";
    if (raw && !raw.startsWith("grant_type")) bodiesSeen.push(JSON.parse(raw));
    const r = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { bodiesSeen, impl };
}

describe("agent-purchase labeling on PayPal orders", () => {
  it("client.createOrder writes the agent marker into unit.custom_id (metadata mode: no funds routing)", async () => {
    const { bodiesSeen, impl } = fetchMock([
      { status: 200, body: TOKEN },
      { status: 201, body: ORDER },
    ]);
    const client = new PayPalClient({ env: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    await client.createOrder({
      amount: "10.00", currency: "USD", requestId: "req-1",
      customId: "cb|agent=a1|mandate=cbmd-x|payee=p@example.com",
    });
    const unit = (bodiesSeen[0] as { purchase_units: Array<Record<string, unknown>> }).purchase_units[0];
    expect(unit.custom_id).toBe("cb|agent=a1|mandate=cbmd-x|payee=p@example.com");
    expect(unit.payee).toBeUndefined();
  });

  it("the enforcer stamps every order with the agent + mandate marker", async () => {
    const { bodiesSeen, impl } = fetchMock([
      { status: 200, body: TOKEN },
      { status: 201, body: ORDER },
      { status: 201, body: CAPTURED },
    ]);
    const client = new PayPalClient({ env: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    const rails = new LiveRails(client, true);
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "label-test-"));
    const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
    const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
    const store = new MandateStore(path.join(stateDir, "mandates.json"));
    const enforcer = new Enforcer(journal, store, rails, keys, stateDir);

    const mandate: Mandate = {
      id: newMandateId(), version: "cb-mandate/v1",
      principal: "p", agent: "shopping-agent-1", purpose: "label test",
      limits: { currency: "USD", maxPerTransaction: "30.00", maxTotalSpend: "60.00",
        windowStart: new Date(Date.now() - 60_000).toISOString(), windowEnd: new Date(Date.now() + 3_600_000).toISOString() },
      issuedAt: new Date().toISOString(),
    };
    store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));

    await enforcer.purchase({ mandateId: mandate.id, amount: "10.00", currency: "USD", description: "labeled buy", payee: "merch@keymagic.example" });
    const unit = (bodiesSeen[0] as { purchase_units: Array<Record<string, unknown>> }).purchase_units[0];
    expect(String(unit.custom_id)).toContain("cb|agent=shopping-agent-1");
    expect(String(unit.custom_id)).toContain("mandate=" + mandate.id);
    expect(String(unit.custom_id)).toContain("payee=merch@keymagic.example");
    expect(unit.payee).toBeUndefined();
  });
});
