import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";
import {
  PayPalToolGateway,
  classifyTool,
  moneyOfCreateOrder,
  moneyOfCreateRefund,
} from "../src/gateway/paypalGateway.js";
import type { UpstreamLike, UpstreamResult, UpstreamTool } from "../src/gateway/paypalMcpUpstream.js";

/** Stands in for @paypal/mcp: remembers every call, serves one 60 USD order. */
class FakeUpstream implements UpstreamLike {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  payee = "seller@example.com";
  async listTools(): Promise<UpstreamTool[]> {
    return ["create_order", "get_order", "pay_order", "create_refund", "list_transactions", "create_invoice"].map((name) => ({
      name, description: `fake ${name}`, inputSchema: { type: "object" },
    }));
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<UpstreamResult> {
    this.calls.push({ name, args });
    const ok = (json: unknown): UpstreamResult => ({ text: JSON.stringify(json), json, isError: false });
    switch (name) {
      case "create_order": return ok({ id: `ORD${this.calls.length}`, status: "CREATED" });
      case "get_order": return ok({
        id: args.id, status: "APPROVED",
        purchase_units: [{ amount: { value: "60.00", currency_code: "USD" }, payee: { email_address: this.payee } }],
      });
      case "pay_order": return ok({ id: args.id, status: "COMPLETED" });
      case "create_refund": return ok({ id: "REF1", status: "COMPLETED" });
      case "list_transactions": return ok({ transaction_details: [] });
      case "create_invoice": return ok({ id: "INV-1", status: "DRAFT" });
      default: return { text: `unknown tool ${name}`, isError: true };
    }
  }
  named(name: string) { return this.calls.filter((c) => c.name === name); }
}

function world() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-test-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);
  const upstream = new FakeUpstream();
  const gateway = new PayPalToolGateway(upstream, enforcer, journal);
  const grant = (limits: { maxPerTransaction: string; maxTotalSpend: string; payees?: string[] }): string => {
    const mandate: Mandate = {
      id: newMandateId(), version: "cb-mandate/v1", principal: "sam", agent: "claude-desktop",
      purpose: "paypal tools under a wall",
      limits: {
        currency: "USD", ...limits,
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date(Date.now() + 3_600_000).toISOString(),
      },
      issuedAt: new Date().toISOString(),
    };
    store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
    return mandate.id;
  };
  return { journal, store, enforcer, upstream, gateway, grant };
}

describe("tool classes and money extraction", () => {
  it("classifies PayPal's tools: spend / read / write (unknown names are writes — fail closed)", () => {
    expect(classifyTool("create_order")).toBe("spend");
    expect(classifyTool("pay_order")).toBe("spend");
    expect(classifyTool("create_refund")).toBe("spend");
    expect(classifyTool("get_order")).toBe("read");
    expect(classifyTool("list_transactions")).toBe("read");
    expect(classifyTool("generate_invoice_qr_code")).toBe("read");
    expect(classifyTool("create_invoice")).toBe("write");
    expect(classifyTool("accept_dispute_claim")).toBe("write");
    expect(classifyTool("something_new")).toBe("write");
  });

  it("measures create_order the way the toolkit prices it: items × cost (+tax) + shipping − discount", () => {
    const m = moneyOfCreateOrder({
      currencyCode: "USD",
      items: [{ name: "a", itemCost: 10, quantity: 2, itemTotal: 20 }, { name: "b", itemCost: 5, taxPercent: 20 }],
      shippingCost: 4.5, discount: 2,
    });
    expect(m).toEqual({ amount: "28.50", currency: "USD" }); // 20 + 6 + 4.5 − 2
    expect(moneyOfCreateOrder({ currencyCode: "USD" })).toHaveProperty("error");
  });

  it("refuses to price a refund it cannot see", () => {
    expect(moneyOfCreateRefund({ capture_id: "CAP1" })).toHaveProperty("error");
    expect(moneyOfCreateRefund({ capture_id: "CAP1", amount: { value: "7.5", currency_code: "USD" } })).toEqual({ amount: "7.50", currency: "USD" });
  });
});

describe("the wall in front of @paypal/mcp", () => {
  it("hands out no tool without a mandate — a signed refusal, and PayPal is never called", async () => {
    const w = world();
    const out = await w.gateway.invoke({ tool: "list_transactions", arguments: {} });
    expect(out.kind).toBe("denial");
    if (out.kind === "denial") expect(out.denial.reasonCode).toBe("MANDATE_NOT_FOUND");
    expect(w.upstream.calls).toHaveLength(0);
  });

  it("forwards a read under a live mandate and journals it (nothing counted)", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "50.00", maxTotalSpend: "100.00" });
    const out = await w.gateway.invoke({ tool: "list_transactions", arguments: {}, mandateId: m });
    expect(out.kind).toBe("forwarded");
    if (out.kind === "forwarded") expect(out.evidence.counted).toBe(false);
    expect(w.upstream.named("list_transactions")).toHaveLength(1);
    expect(w.journal.eventsOfType("external_call_completed")).toHaveLength(1);
    expect(w.journal.capturedMinorFor(m)).toBe(0n);
  });

  it("create_order over the per-purchase cap: refused before PayPal hears about it", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "50.00", maxTotalSpend: "100.00" });
    const out = await w.gateway.invoke({
      tool: "create_order", mandateId: m,
      arguments: { currencyCode: "USD", items: [{ name: "PS5", itemCost: 499, itemTotal: 499 }] },
      intent: { text: "buy me a PS5", channel: "claude" },
    });
    expect(out.kind).toBe("denial");
    if (out.kind === "denial") {
      expect(out.denial.reasonCode).toBe("OVER_PER_TRANSACTION");
      expect(out.denial.requested.amount).toBe("499.00");
      expect(w.enforcer.fullDenial(out.denial.denialId)).toBeDefined(); // verifiable like any refusal
    }
    expect(w.upstream.calls).toHaveLength(0);
  });

  it("create_order under the cap: forwarded, measured, journalled — a commitment, not yet a spend", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "50.00", maxTotalSpend: "100.00" });
    const out = await w.gateway.invoke({
      tool: "create_order", mandateId: m,
      arguments: { currencyCode: "USD", items: [{ name: "cable", itemCost: 12.5, quantity: 2, itemTotal: 25 }] },
    });
    expect(out.kind).toBe("forwarded");
    if (out.kind === "forwarded") {
      expect((out.result as { id: string }).id).toMatch(/^ORD/);
      expect(out.evidence.money).toEqual({ amount: "25.00", currency: "USD" });
      expect(out.evidence.counted).toBe(false);
    }
    expect(w.journal.eventsOfType("external_call_authorized")).toHaveLength(1);
    expect(w.journal.capturedMinorFor(m)).toBe(0n);
  });

  it("pay_order reads the order back first: 60 USD against a 50 cap is refused, PayPal only saw get_order", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "50.00", maxTotalSpend: "100.00" });
    const out = await w.gateway.invoke({ tool: "pay_order", mandateId: m, arguments: { id: "ORDX" } });
    expect(out.kind).toBe("denial");
    if (out.kind === "denial") expect(out.denial.reasonCode).toBe("OVER_PER_TRANSACTION");
    expect(w.upstream.named("get_order")).toHaveLength(1);
    expect(w.upstream.named("pay_order")).toHaveLength(0);
  });

  it("pay_order inside the walls is captured AND counted — the next one meets the total cap", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "80.00", maxTotalSpend: "100.00", payees: ["seller@example.com"] });
    const first = await w.gateway.invoke({ tool: "pay_order", mandateId: m, arguments: { id: "ORD-A" } });
    expect(first.kind).toBe("forwarded");
    if (first.kind === "forwarded") expect(first.evidence.counted).toBe(true);
    expect(w.journal.capturedMinorFor(m)).toBe(6000n);
    expect(w.journal.eventsOfType("external_spend")).toHaveLength(1);

    const second = await w.gateway.invoke({ tool: "pay_order", mandateId: m, arguments: { id: "ORD-B" } });
    expect(second.kind).toBe("denial");
    if (second.kind === "denial") expect(second.denial.reasonCode).toBe("OVER_TOTAL_CAP");
    expect(w.upstream.named("pay_order")).toHaveLength(1);
  });

  it("pay_order to a payee off the allowlist is refused by name", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "80.00", maxTotalSpend: "100.00", payees: ["trusted@example.com"] });
    const out = await w.gateway.invoke({ tool: "pay_order", mandateId: m, arguments: { id: "ORD-C" } });
    expect(out.kind).toBe("denial");
    if (out.kind === "denial") expect(out.denial.reasonCode).toBe("PAYEE_NOT_ALLOWED");
  });

  it("create_refund without an amount is refused as unmeasurable, with the reason on the denial", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "80.00", maxTotalSpend: "100.00" });
    const out = await w.gateway.invoke({ tool: "create_refund", mandateId: m, arguments: { capture_id: "CAP123456789012345" } });
    expect(out.kind).toBe("denial");
    if (out.kind === "denial") {
      expect(out.denial.reasonCode).toBe("INVALID_AMOUNT");
      expect(out.denial.requested.description).toMatch(/explicit amount/);
    }
    expect(w.upstream.named("create_refund")).toHaveLength(0);
  });

  it("a write (create_invoice) needs the mandate's authority but no money; a revoked mandate loses every tool", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "1.00", maxTotalSpend: "1.00" });
    const inv = await w.gateway.invoke({ tool: "create_invoice", mandateId: m, arguments: { currency_code: "USD" } });
    expect(inv.kind).toBe("forwarded");
    w.store.revoke(m, "principal pulled the plug");
    const after = await w.gateway.invoke({ tool: "list_transactions", mandateId: m, arguments: {} });
    expect(after.kind).toBe("denial");
    if (after.kind === "denial") expect(after.denial.reasonCode).toBe("MANDATE_REVOKED");
  });

  it("retries are idempotent: the same create_order twice reaches PayPal once", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "50.00", maxTotalSpend: "100.00" });
    const args = { currencyCode: "USD", items: [{ name: "pen", itemCost: 3, itemTotal: 3 }] };
    const a = await w.gateway.invoke({ tool: "create_order", mandateId: m, arguments: args, logicalKey: "lk-pen" });
    const b = await w.gateway.invoke({ tool: "create_order", mandateId: m, arguments: args, logicalKey: "lk-pen" });
    expect(a).toEqual(b);
    expect(w.upstream.named("create_order")).toHaveLength(1);
  });
});

describe("what counts as money moved", () => {
  it("a well-formed JSON failure from the toolkit is a failure, and is never counted", async () => {
    const w = world();
    const m = w.grant({ maxPerTransaction: "80.00", maxTotalSpend: "100.00" });
    w.upstream.callTool = async (name, args) => {
      w.upstream.calls.push({ name, args });
      if (name === "get_order") return { text: "", json: { id: args.id, purchase_units: [{ amount: { value: "60.00", currency_code: "USD" } }] }, isError: false };
      return { text: "", json: { ok: false, status: 422, code: "PAYPAL_API_HTTP_ERROR", message: "Payer has not yet approved the Order" }, isError: false };
    };
    const out = await w.gateway.invoke({ tool: "pay_order", mandateId: m, arguments: { id: "ORD-NOT-APPROVED" } });
    expect(out.kind).toBe("forwarded");
    if (out.kind === "forwarded") {
      expect(out.upstreamError).toBe(true);
      expect(out.evidence.counted).toBe(false);
    }
    expect(w.journal.capturedMinorFor(m)).toBe(0n);
    expect(w.journal.eventsOfType("external_call_failed")).toHaveLength(1);
    // and the failed attempt is not memoised: a retry after approval reaches PayPal again
    await w.gateway.invoke({ tool: "pay_order", mandateId: m, arguments: { id: "ORD-NOT-APPROVED" } });
    expect(w.upstream.named("pay_order")).toHaveLength(2);
  });
});
