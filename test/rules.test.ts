import { describe, expect, it } from "vitest";
import { DisputeRuleStore } from "../src/disputes/rules.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("dispute automation rules (coverage-aware)", () => {
  const store = () => new DisputeRuleStore(join(mkdtempSync(join(tmpdir(), "rules-")), "rules.json"));

  it("matches by reason and amount, highest priority first", () => {
    const s = store();
    s.create({ name: "big refunds", reasons: ["ITEM_NOT_RECEIVED"], maxAmount: 50, action: "auto_refund", priority: 10 });
    s.create({ name: "catch all refund", action: "auto_refund", priority: 1 });
    const m = s.match({ reason: "ITEM_NOT_RECEIVED", amount: "30.00", currency: "USD" }, { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: false });
    expect(m?.rule.name).toBe("big refunds");
  });

  it("the coverage guard stops an auto_refund rule from settling a case the pack would WIN", () => {
    const s = store();
    s.create({ name: "blanket refund", action: "auto_refund" });
    const m = s.match("UNAUTHORIZED_TRANSACTION" as never as any === undefined ? ({} as any) : ({ reason: "UNAUTHORIZED_TRANSACTION", amount: "30.00", currency: "USD" } as any), { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: true });
    expect(m).toBeUndefined(); // FIGHT beats the rule — the mandate wins the case
  });

  it("amount cap blocks big disputes", () => {
    const s = store();
    s.create({ name: "small only", maxAmount: 20, action: "auto_refund" });
    expect(s.match({ reason: "ITEM_NOT_RECEIVED", amount: "30.00", currency: "USD" }, { hasLinkedReceipt: true, isRecurringMandate: false, hasFulfillment: true })).toBeUndefined();
  });
});
