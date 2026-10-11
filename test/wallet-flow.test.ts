import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshKeys, makeMandate } from "./helpers.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import type { CaptureResult, CreateOrderArgs, OrderResult, PaymentRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";
import { verifyFullReceipt } from "../src/receipts/receipts.js";

/**
 * Wallet rails that require buyer approval before money moves — the
 * human-in-the-loop shape PayPal's wallet orders really have.
 */
class TwoPhaseMockRails implements PaymentRails {
  readonly mode = "mock" as const;
  captureCalls = 0;
  private approved = false;
  readonly approvalUrl = "https://www.sandbox.paypal.test/checkoutnow?token=MOCK-W1";

  async createOrder(_args: CreateOrderArgs): Promise<OrderResult> {
    return { id: "MOCK-W1", status: "PAYER_ACTION_REQUIRED" };
  }

  async captureOrder(orderId: string, _requestId: string): Promise<CaptureResult> {
    this.captureCalls += 1;
    if (!this.approved) return { orderId, captureId: "", status: "PAYER_ACTION_REQUIRED", approvalUrl: this.approvalUrl };
    return { orderId, captureId: "MOCK-CAP-W1", status: "COMPLETED" };
  }

  buyerApproves(): void {
    this.approved = true;
  }
}

function walletWorld(rails: TwoPhaseMockRails) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-wallet-"));
  const keys = freshKeys();
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, rails, keys, stateDir);
  const { mandate } = makeMandate(keys);
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  return { enforcer, journal, store, mandateId: mandate.id, logicalKey: `wallet-${mandate.id}` };
}

describe("two-phase wallet purchase (human-in-the-loop)", () => {
  it("stops at PAYER_ACTION_REQUIRED with the intent journalled — no receipt yet", async () => {
    const rails = new TwoPhaseMockRails();
    const w = walletWorld(rails);
    const outcome = await w.enforcer.purchase({
      mandateId: w.mandateId,
      amount: "15.00",
      currency: "USD",
      description: "agent shopping demo",
    });
    expect(outcome.kind).toBe("pending");
    if (outcome.kind !== "pending") return;
    expect(outcome.orderId).toBe("MOCK-W1");
    expect(outcome.approvalUrl).toContain("checkoutnow");
    const types = w.journal.eventsFor(() => true).map((e) => e.type);
    expect(types).toContain("purchase_requested");
    expect(types).toContain("order_created");
    expect(types).toContain("order_awaiting_buyer");
    expect(types).not.toContain("order_captured");
    expect(w.journal.verify().ok).toBe(true);
  });

  it("refuses to capture before the buyer approves", async () => {
    const rails = new TwoPhaseMockRails();
    const w = walletWorld(rails);
    const first = await w.enforcer.purchase({
      mandateId: w.mandateId,
      amount: "15.00",
      currency: "USD",
      description: "x",
      logicalKey: w.logicalKey,
    });
    expect(first.kind).toBe("pending");
    await expect(w.enforcer.resumePurchase(w.logicalKey)).rejects.toThrow(/not approved/);
    expect(rails.captureCalls).toBe(2); // first attempt + resume attempt, both pending
  });

  it("captures after approval and issues a fully verifiable receipt", async () => {
    const rails = new TwoPhaseMockRails();
    const w = walletWorld(rails);
    await w.enforcer.purchase({
      mandateId: w.mandateId,
      amount: "15.00",
      currency: "USD",
      description: "demo",
      logicalKey: w.logicalKey,
    });
    rails.buyerApproves();
    const outcome = await w.enforcer.resumePurchase(w.logicalKey);
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") return;
    const report = verifyFullReceipt(outcome.full);
    expect(report.overall).toBe(true);
    const types = w.journal.eventsFor(() => true).map((e) => e.type);
    expect(types).toContain("order_captured");
    expect(w.journal.capturedMinorFor(w.mandateId)).toBe(1500n);
    expect(w.journal.verify().ok).toBe(true);
  });
});
