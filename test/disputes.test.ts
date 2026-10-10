import { describe, expect, it } from "vitest";
import { setupWorld } from "./helpers.js";
import { DisputeService, denialsForMandate } from "../src/disputes/service.js";
import { buildEvidencePack, toMarkdown, toProvideEvidenceEntries } from "../src/disputes/evidence.js";
import { PayPalClient } from "../src/paypal/client.js";

async function worldWithPurchases() {
  const w = setupWorld();
  const p1 = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "25.00", currency: "USD", description: "coffee beans", logicalKey: "d-1" });
  const p2 = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "30.00", currency: "USD", description: "desk mat", logicalKey: "d-2" });
  await w.enforcer.purchase({ mandateId: w.mandateId, amount: "25.00", currency: "USD", description: "over cap", logicalKey: "d-3" });
  const service = new DisputeService({
    railsMode: "mock",
    enforcer: w.enforcer,
    journal: w.journal,
  });
  return { w, service, p1, p2 };
}

describe("DisputeService (mock)", () => {
  it("seeds disputes linked to the receipts on file", async () => {
    const { service } = await worldWithPurchases();
    const list = await service.list();
    expect(service.source).toBe("mock");
    expect(list.length).toBe(2);
    expect(list.every((d) => d.source === "mock")).toBe(true);
    expect(list.every((d) => d.disputeId.startsWith("MOCK-"))).toBe(true);
    expect(list.every((d) => d.linkedReceiptId && d.respondBy)).toBe(true);
    expect(list.every((d) => d.disputedTransactions?.[0]?.transaction_id?.startsWith("MOCK-"))).toBe(true);
  });

  it("get() returns a seeded dispute by id", async () => {
    const { service } = await worldWithPurchases();
    const d = await service.get("MOCK-D-001");
    expect(d?.disputeId).toBe("MOCK-D-001");
    expect(await service.get("nope")).toBeUndefined();
  });

  it("refuses sandbox-only operations in mock mode with an honest message", async () => {
    const { service } = await worldWithPurchases();
    const seeded = await service.createSample({ transactionId: "MOCK-0001", reason: "ITEM_NOT_RECEIVED" });
    expect(seeded.ok).toBe(false);
    expect(seeded.detail).toMatch(/sandbox/);
    const submitted = await service.submitEvidence("MOCK-D-001", [{ evidence_type: "PROOF_OF_TRANSACTION" }]);
    expect(submitted.ok).toBe(false);
    expect(submitted.detail).toMatch(/pack itself is real/);
  });
});

describe("denialsForMandate", () => {
  it("collects the signed refusals that prove enforcement was live", async () => {
    const { w, p1 } = await worldWithPurchases();
    if (p1.kind !== "receipt") throw new Error("expected receipt");
    const denials = denialsForMandate(w.enforcer, p1.receipt);
    expect(denials.length).toBeGreaterThan(0);
    expect(denials[0].reasonCode).toBe("OVER_TOTAL_CAP");
  });
});

describe("buildEvidencePack", () => {
  it("assembles a verifiable pack for a linked dispute", async () => {
    const { w, service } = await worldWithPurchases();
    const d = await service.get("MOCK-D-001");
    expect(d).toBeDefined();
    const pack = buildEvidencePack(d!, { enforcer: w.enforcer, journal: w.journal, store: w.store });

    expect(pack.dispute.disputeId).toBe("MOCK-D-001");
    expect(pack.chain.ok).toBe(true);
    expect(pack.linkedPurchase).toBeDefined();
    expect(pack.linkedPurchase!.eventSeqs.length).toBe(3); // intent -> order -> capture
    expect(pack.linkedPurchase!.mandateSignature).toBeTruthy();
    expect(pack.enforcement.signedRefusals.length).toBeGreaterThan(0);
    expect(pack.pending.join(" ")).toMatch(/fulfillment evidence/i); // honest about what's missing

    const md = toMarkdown(pack);
    expect(md).toContain("Dispute evidence pack — MOCK-D-001");
    expect(md).toContain(pack.linkedPurchase!.receipt.receiptId);
    expect(md).toMatch(/chain verified at generation: \*\*OK\*\*/);
    expect(md).toMatch(/signed refusals/i);
    expect(md).toMatch(/not yet attached/);
  });

  it("states plainly when no receipt is linked", async () => {
    const { w } = await worldWithPurchases();
    const orphan = {
      disputeId: "MOCK-D-404",
      reason: "ITEM_NOT_RECEIVED",
      status: "OPEN",
      source: "mock" as const,
    };
    const pack = buildEvidencePack(orphan, { enforcer: w.enforcer, journal: w.journal, store: w.store });
    expect(pack.linkedPurchase).toBeUndefined();
    expect(pack.pending.join(" ")).toMatch(/no linked purchase/);
    expect(toMarkdown(pack)).toMatch(/\*\*none on file\*\*/);
  });

  it("shapes provide-evidence entries for the PayPal endpoint", async () => {
    const { w, service } = await worldWithPurchases();
    const d = await service.get("MOCK-D-001");
    const pack = buildEvidencePack(d!, { enforcer: w.enforcer, journal: w.journal, store: w.store });
    const entries = toProvideEvidenceEntries(pack);
    expect(entries.length).toBe(2);
    expect(entries[0].evidence_type).toBe("PROOF_OF_TRANSACTION");
    expect(String(entries[0].notes)).toContain("MOCK-D-001");
    expect(entries[1].evidence_type).toBe("PROOF_OF_PERMISSION");
  });
});

describe("PayPalClient dispute endpoints", () => {
  async function clientWithMock(capture: Array<{ url: string; init: RequestInit }>) {
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      capture.push({ url: String(url), init: init ?? {} });
      if (String(url).includes("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ dispute_id: "PP-D-1", status: "OPEN" }), { status: 200 });
    }) as typeof fetch;
    return new PayPalClient({ env: "sandbox", clientId: "cid", clientSecret: "sec", fetchImpl: impl });
  }

  it("posts evidence to the right endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = await clientWithMock(calls);
    const res = await client.provideEvidence("PP-D-1", [{ evidence_type: "PROOF_OF_TRANSACTION", notes: "pack" }], "see notes");
    expect(res.ok).toBe(true);
    const last = calls[calls.length - 1];
    expect(last.url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1/provide-evidence");
    expect(last.init.method).toBe("POST");
    const body = JSON.parse(String(last.init.body));
    expect(body.evidence).toHaveLength(1);
    expect(body.notes).toBe("see notes");
  });

  it("creates SAMPLE disputes in sandbox shape", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = await clientWithMock(calls);
    const res = await client.createSampleDispute({ transactionId: "5TY05013", reason: "ITEM_NOT_RECEIVED" });
    expect(res.ok).toBe(true);
    const last = calls[calls.length - 1];
    expect(last.url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes");
    const body = JSON.parse(String(last.init.body));
    expect(body.mode).toBe("SAMPLE_DISPUTE");
    expect(body.disputed_transaction.transaction_id).toBe("5TY05013");
  });
});
