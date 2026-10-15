import { describe, expect, it } from "vitest";
import { setupWorld } from "./helpers.js";
import { requiredEvidenceFor, coverageFor, recommendDefense } from "../src/disputes/coverage.js";
import { buildEvidencePack, toMarkdown, toProvideEvidenceEntries } from "../src/disputes/evidence.js";
import { DisputeService } from "../src/disputes/service.js";

async function worldWithPurchases() {
  const w = setupWorld();
  const p1 = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "25.00", currency: "USD", description: "coffee beans", logicalKey: "sd-1" });
  const p2 = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "30.00", currency: "USD", description: "desk mat", logicalKey: "sd-2" });
  const service = new DisputeService({ railsMode: "mock", enforcer: w.enforcer, journal: w.journal });
  return { w, service, p1, p2 };
}

describe("PayPal evidence matrix (dig: developer.paypal.com/disputes/reasons-evidence)", () => {
  it("maps both spellings of each reason to the required slots", () => {
    for (const reason of ["ITEM_NOT_RECEIVED", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"]) {
      expect(requiredEvidenceFor(reason).map((s) => s.evidenceType)).toEqual(["PROOF_OF_FULFILLMENT", "PROOF_OF_REFUND"]);
    }
    // the "my agent didn't order this" reason carries the authorization slot
    const unauth = requiredEvidenceFor("UNAUTHORIZED_TRANSACTION").map((s) => s.evidenceType);
    expect(unauth).toContain("OTHER");
    expect(unauth).toContain("PROOF_OF_FULFILLMENT");
    // unknown reasons still get a sane fallback
    expect(requiredEvidenceFor("SOMETHING_NEW")).toHaveLength(2);
  });

  it("scores coverage from provable facts", () => {
    const weak = coverageFor("ITEM_NOT_RECEIVED", { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: false });
    expect(weak.slots.find((s) => s.evidenceType === "PROOF_OF_FULFILLMENT")?.status).toBe("missing");
    const strong = coverageFor("ITEM_NOT_RECEIVED", { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: true });
    expect(strong.slots.find((s) => s.evidenceType === "PROOF_OF_FULFILLMENT")?.status).toBe("covered");
    // a missing refund slot is the "settle instead" door, not a coverage failure
    expect(strong.slots.find((s) => s.evidenceType === "PROOF_OF_REFUND")?.status).toBe("missing");
    expect(strong.covered).toBe(strong.total);
  });
});

describe("fight-or-refund recommendation", () => {
  it("FIGHTS unauthorized claims with the signed mandate — the unfalsifiable claim, falsified", () => {
    const rec = recommendDefense("UNAUTHORIZED_TRANSACTION", { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: false });
    expect(rec.action).toBe("FIGHT");
    expect(rec.because).toMatch(/mandate/);
  });

  it("FIGHTS recurring-billing claims with the mandate as the subscription agreement", () => {
    const rec = recommendDefense("CANCELED_RECURRING_BILLING", { hasLinkedReceipt: true, isRecurringMandate: true, hasFulfillment: false });
    expect(rec.action).toBe("FIGHT");
    expect(rec.because).toMatch(/subscription agreement/);
  });

  it("REFUNDS FIRST when fulfillment cannot be evidenced — cheaper than losing at the network's clock", () => {
    const rec = recommendDefense("ITEM_NOT_RECEIVED", { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: false });
    expect(rec.action).toBe("REFUND_FIRST");
    expect(rec.because).toMatch(/PROOF_OF_FULFILLMENT/);
  });
});

describe("evidence pack coverage integration", () => {
  it("packs coverage, recommendation and targeted entries; fulfillment fills the slot", async () => {
    const { w, service, p1 } = await worldWithPurchases();
    if (p1.kind !== "receipt") throw new Error("expected receipt");

    // merchant's fulfillment system journals the tracking BEFORE the dispute
    w.journal.append("order_fulfilled", {
      order_id: p1.receipt.orderId,
      carrier: "La Poste",
      tracking_number: "6A12345678901",
      shipped_at: new Date().toISOString(),
      source: "merchant fulfillment",
    });

    const d = await service.get("MOCK-D-001");
    if (!d) throw new Error("expected dispute");
    d.linkedReceiptId = p1.receipt.receiptId;
    d.linkedOrderId = p1.receipt.orderId;
    const pack = buildEvidencePack(d, { enforcer: w.enforcer, journal: w.journal, store: w.store });

    expect(pack.coverage.total).toBeGreaterThan(0);
    expect(pack.coverage.slots.find((s) => s.evidenceType === "PROOF_OF_FULFILLMENT")?.status).toBe("covered");
    expect(pack.fulfillment?.carrier).toBe("La Poste");
    expect(pack.fulfillment?.trackingNumber).toBe("6A12345678901");
    expect(pack.recommendation.action).toBe("FIGHT"); // full coverage → fight

    // entries are targeted at the slots PayPal actually asks for
    const entries = toProvideEvidenceEntries(pack);
    const types = entries.map((e) => e.evidence_type);
    expect(types).toContain("PROOF_OF_FULFILLMENT");
    expect(types).toContain("OTHER");
    expect(types).not.toContain("PROOF_OF_PERMISSION"); // not a slot in PayPal's matrix
    expect(types).not.toContain("PROOF_OF_TRANSACTION");
    const ff = entries.find((e) => e.evidence_type === "PROOF_OF_FULFILLMENT") as { evidence_info?: { tracking_info?: Array<{ carrier_name?: string; tracking_number?: string }> } };
    expect(ff.evidence_info?.tracking_info?.[0]).toEqual({ carrier_name: "La Poste", tracking_number: "6A12345678901" });
    // no refund was issued → the refund slot is NOT claimed
    expect(types).not.toContain("PROOF_OF_REFUND");

    const md = toMarkdown(pack);
    expect(md).toMatch(/Defense recommendation: \*\*FIGHT\*\*/);
    expect(md).toMatch(/required slots covered/);
  });

  it("without fulfillment, the pack stays honest: slot missing, recommendation to settle first", async () => {
    const { w, service, p2 } = await worldWithPurchases();
    if (p2.kind !== "receipt") throw new Error("expected receipt");
    const d = await service.get("MOCK-D-001");
    if (!d) throw new Error("expected dispute");
    d.linkedReceiptId = p2.receipt.receiptId;
    d.linkedOrderId = p2.receipt.orderId;
    const pack = buildEvidencePack(d, { enforcer: w.enforcer, journal: w.journal, store: w.store });
    expect(pack.coverage.slots.find((s) => s.evidenceType === "PROOF_OF_FULFILLMENT")?.status).toBe("missing");
    expect(pack.recommendation.action).toBe("REFUND_FIRST");
    const entries = toProvideEvidenceEntries(pack);
    expect(entries.map((e) => e.evidence_type)).not.toContain("PROOF_OF_FULFILLMENT");
    expect(pack.pending.join(" ")).toMatch(/fulfillment evidence not yet attached/);
  });
});
