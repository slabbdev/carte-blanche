import { describe, expect, it } from "vitest";
import { setupWorld } from "./helpers.js";
import { verifyFullReceipt, verifyFullDenial } from "../src/receipts/receipts.js";

describe("Enforcer", () => {
  it("allows a purchase within limits and issues a verifiable receipt", async () => {
    const w = setupWorld();
    const outcome = await w.enforcer.purchase({
      mandateId: w.mandateId,
      amount: "25.00",
      currency: "USD",
      description: "coffee beans",
    });
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") return;
    expect(outcome.receipt.orderId).toMatch(/^MOCK-/);
    expect(w.mock.createOrderCalls).toBe(1);
    const report = verifyFullReceipt(outcome.full);
    expect(report.overall).toBe(true);
  });

  it("refuses over the per-transaction cap — with a signed proof", async () => {
    const w = setupWorld();
    const outcome = await w.enforcer.purchase({
      mandateId: w.mandateId,
      amount: "31.00",
      currency: "USD",
      description: "too expensive",
    });
    expect(outcome.kind).toBe("denial");
    if (outcome.kind !== "denial") return;
    expect(outcome.denial.reasonCode).toBe("OVER_PER_TRANSACTION");
    const report = verifyFullDenial(outcome.full);
    expect(report.overall).toBe(true);
    expect(w.mock.createOrderCalls).toBe(0);
  });

  it("enforces the cumulative cap across purchases", async () => {
    const w = setupWorld(); // cap 60.00
    const ok1 = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "30.00", currency: "USD", description: "one" });
    const ok2 = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "30.00", currency: "USD", description: "two" });
    expect(ok1.kind).toBe("receipt");
    expect(ok2.kind).toBe("receipt");
    const third = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "0.01", currency: "USD", description: "one cent too far" });
    expect(third.kind).toBe("denial");
    if (third.kind !== "denial") return;
    expect(third.denial.reasonCode).toBe("OVER_TOTAL_CAP");
    expect(third.denial.reasonDetail).toMatch(/remaining 0\.00/);
  });

  it("refuses after revocation", async () => {
    const w = setupWorld();
    w.store.revoke(w.mandateId, "changed my mind");
    const outcome = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "5.00", currency: "USD", description: "x" });
    expect(outcome.kind).toBe("denial");
    if (outcome.kind !== "denial") return;
    expect(outcome.denial.reasonCode).toBe("MANDATE_REVOKED");
  });

  it("refuses outside the time window", async () => {
    const w = setupWorld({ windowEnd: new Date(Date.now() - 1000).toISOString() });
    const outcome = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "5.00", currency: "USD", description: "x" });
    expect(outcome.kind).toBe("denial");
    if (outcome.kind !== "denial") return;
    expect(outcome.denial.reasonCode).toBe("WINDOW_EXPIRED");
  });

  it("enforces the payee allowlist", async () => {
    const w = setupWorld({ payees: ["store@example.com"] });
    const bad = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "5.00", currency: "USD", description: "x", payee: "other@evil.example" });
    expect(bad.kind).toBe("denial");
    if (bad.kind !== "denial") return;
    expect(bad.denial.reasonCode).toBe("PAYEE_NOT_ALLOWED");
    const good = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "5.00", currency: "USD", description: "x", payee: "store@example.com" });
    expect(good.kind).toBe("receipt");
  });

  it("rejects a currency mismatch", async () => {
    const w = setupWorld();
    const outcome = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "5.00", currency: "EUR", description: "x" });
    expect(outcome.kind).toBe("denial");
    if (outcome.kind !== "denial") return;
    expect(outcome.denial.reasonCode).toBe("CURRENCY_MISMATCH");
  });

  it("signs a refusal even for an unknown mandate", async () => {
    const w = setupWorld();
    const outcome = await w.enforcer.purchase({ mandateId: "cbmd-does-not-exist", amount: "5.00", currency: "USD", description: "x" });
    expect(outcome.kind).toBe("denial");
    if (outcome.kind !== "denial") return;
    expect(outcome.denial.reasonCode).toBe("MANDATE_NOT_FOUND");
    expect(outcome.full.mandate).toBeNull();
    expect(outcome.full.denialSignature).toBeTruthy();
  });

  it("is idempotent: the same logical key never triggers a second PayPal call", async () => {
    const w = setupWorld();
    const req = { mandateId: w.mandateId, amount: "10.00", currency: "USD", description: "retry me", logicalKey: "fixed-key-1" };
    const first = await w.enforcer.purchase(req);
    const second = await w.enforcer.purchase(req);
    expect(first.kind).toBe("receipt");
    expect(second.kind).toBe("receipt");
    if (first.kind !== "receipt" || second.kind !== "receipt") return;
    expect(second.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(w.mock.createOrderCalls).toBe(1);
  });

  it("produces receipts that survive a server restart", async () => {
    const w = setupWorld();
    const outcome = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "10.00", currency: "USD", description: "durable" });
    expect(outcome.kind).toBe("receipt");
    // simulate a restart: same state dir and keys, fresh objects
    const { Journal } = await import("../src/journal/journal.js");
    const { MandateStore } = await import("../src/mandate/store.js");
    const { Enforcer } = await import("../src/enforcer/enforcer.js");
    const { MockRails } = await import("../src/paypal/adapter.js");
    const journal2 = new Journal(`${w.stateDir}/journal.jsonl`, w.keys.journal);
    const store2 = new MandateStore(`${w.stateDir}/mandates.json`);
    const enforcer2 = new Enforcer(journal2, store2, new MockRails(), w.keys, w.stateDir);
    const full = enforcer2.fullReceipt(outcome.kind === "receipt" ? outcome.receipt.receiptId : "");
    expect(full).toBeDefined();
    const report = verifyFullReceipt(full!);
    expect(report.overall).toBe(true);
  });
});
