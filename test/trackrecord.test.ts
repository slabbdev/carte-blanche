import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TrackRecordService } from "../src/agent/trackrecord.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";

function setup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "trackrecord-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);
  const service = new TrackRecordService(journal, keys.server);
  return { journal, store, enforcer, service, keys };
}

function grant(ctx: ReturnType<typeof setup>, agent: string): string {
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "test",
    agent,
    purpose: "track record fixture",
    limits: {
      currency: "USD",
      maxPerTransaction: "30.00",
      maxTotalSpend: "100.00",
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  ctx.store.put(signMandate(mandate, ctx.keys.server.privateKeyB64, ctx.keys.server.publicKeyB64));
  ctx.journal.append("mandate_issued", { mandate_id: mandate.id, principal: mandate.principal, agent });
  return mandate.id;
}

describe("agent track record (signed reputation from the sealed chain)", () => {
  it("computes what an agent did: captures, spend, refusals by reason — and signs it", async () => {
    const ctx = setup();
    const mandate = grant(ctx, "shopping-agent-1");
    // one purchase, one denial
    await ctx.enforcer.purchase({ mandateId: mandate, amount: "20.00", currency: "USD", description: "ok buy" });
    await ctx.enforcer.purchase({ mandateId: mandate, amount: "40.00", currency: "USD", description: "over the wall" });
    // another agent's activity must NOT count
    const other = grant(ctx, "other-agent");
    await ctx.enforcer.purchase({ mandateId: other, amount: "10.00", currency: "USD", description: "not mine" });

    const statement = ctx.service.statementFor("shopping-agent-1");
    expect(statement.mandatesIssued).toBe(1);
    expect(statement.purchasesCaptured).toBe(1);
    expect(statement.captured).toEqual([{ currency: "USD", amount: "20.00" }]);
    expect(statement.refusals).toEqual([{ code: "OVER_PER_TRANSACTION", count: 1 }]);
    expect(statement.guarantee).toMatch(/no bypass path/);
    expect(TrackRecordService.verify(statement)).toBe(true);
  });

  it("a tampered statement does not verify", async () => {
    const ctx = setup();
    const mandate = grant(ctx, "agent-x");
    await ctx.enforcer.purchase({ mandateId: mandate, amount: "5.00", currency: "USD", description: "tiny" });
    const statement = ctx.service.statementFor("agent-x");
    const forged = { ...statement, purchasesCaptured: 999 };
    expect(TrackRecordService.verify(forged)).toBe(false);
  });

  it("unknown agents get an honest zero statement", () => {
    const ctx = setup();
    const statement = ctx.service.statementFor("nobody");
    expect(statement.mandatesIssued).toBe(0);
    expect(statement.purchasesCaptured).toBe(0);
    expect(statement.refusals).toEqual([]);
    expect(TrackRecordService.verify(statement)).toBe(true);
  });
});
