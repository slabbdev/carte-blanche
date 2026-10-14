import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JourneyPlanner, executeJourney, journeyTotal, mandateLimitsFrom } from "../src/journey/journey.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";

function setup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "journey-test-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);
  const planner = new JourneyPlanner(stateDir, journal);
  return { stateDir, journal, store, enforcer, planner, keys };
}

function approveFixture(ctx: ReturnType<typeof setup>, journeyId: string, journey: { name: string; currency: string; items: Array<{ merchant?: string; price: string; quantity: number }> }) {
  const limits = mandateLimitsFrom(journey as never);
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "test",
    agent: "agent-1",
    purpose: `journey: ${journey.name}`,
    limits: {
      currency: journey.currency,
      maxPerTransaction: limits.maxPerTransaction,
      maxTotalSpend: limits.maxTotalSpend,
      payees: limits.payees.length > 0 ? limits.payees : undefined,
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  ctx.store.put(signMandate(mandate, ctx.keys.server.privateKeyB64, ctx.keys.server.publicKeyB64));
  ctx.journal.append("mandate_issued", { mandate_id: mandate.id, principal: mandate.principal, agent: mandate.agent });
  return ctx.planner.markApproved(journeyId, mandate.id)!;
}

describe("journey planner", () => {
  it("plans a journey and derives mandate limits from the basket", () => {
    const ctx = setup();
    const j = ctx.planner.plan("team setup", "USD", [
      { title: "keyboard", merchant: "keychron.com", price: "49.99", quantity: 2 },
      { title: "desk mat", merchant: "redragonshop.com", price: "19.99" },
    ]);
    expect(j.items).toHaveLength(2);
    expect(journeyTotal(j)).toBe("119.97");
    const limits = mandateLimitsFrom(j);
    expect(limits.maxPerTransaction).toBe("99.98"); // keyboard x2
    expect(limits.maxTotalSpend).toBe("119.97");
    expect(limits.payees.sort()).toEqual(["keychron.com", "redragonshop.com"]);
  });

  it("runs an approved journey: every in-list line purchases under the derived mandate", async () => {
    const ctx = setup();
    const planned = ctx.planner.plan("team setup", "USD", [
      { title: "keyboard", merchant: "keychron.com", price: "49.99" },
      { title: "desk mat", merchant: "redragonshop.com", price: "19.99" },
    ]);
    const j = approveFixture(ctx, planned.id, planned);
    const after = await executeJourney(j, ctx.journal, ctx.enforcer);
    expect(after.items.every((i) => i.status === "receipt")).toBe(true);
    expect(after.items[0].outcomeId).toMatch(/^rcpt-/);
    const attemptEvents = ctx.journal.eventsFor((d) => d.journey_id === j.id && (d as { line_id?: string }).line_id);
    expect(attemptEvents).toHaveLength(2);
  });

  it("lines added after approval run into the signed walls: amount, allowlist and budget each refuse with proof", async () => {
    const ctx = setup();
    const planned = ctx.planner.plan("small basket", "USD", [
      { title: "keyboard", merchant: "keychron.com", price: "49.99" },
    ]);
    let j = approveFixture(ctx, planned.id, planned);

    // added AFTER the signature — each one meets a different wall:
    j = ctx.planner.addLine(j.id, { title: "sneaky upgrade", merchant: "keychron.com", price: "500.00" })!; // over per-purchase cap
    j = ctx.planner.addLine(j.id, { title: "off-list bargain", merchant: "offgrid.example", price: "5.00" })!; // under cap, off-list
    j = ctx.planner.addLine(j.id, { title: "second keyboard", merchant: "keychron.com", price: "20.00" })!; // in-list, blows the budget

    const after = await executeJourney(j, ctx.journal, ctx.enforcer);
    const byTitle = (t: string) => after.items.find((i) => i.title === t)!;
    expect(byTitle("keyboard").status).toBe("receipt");
    expect(byTitle("sneaky upgrade").detail).toMatch(/OVER_PER_TRANSACTION/);
    expect(byTitle("off-list bargain").detail).toMatch(/PAYEE_NOT_ALLOWED/);
    expect(byTitle("second keyboard").detail).toMatch(/OVER_TOTAL_CAP/);
    for (const t of ["sneaky upgrade", "off-list bargain", "second keyboard"]) {
      expect(byTitle(t).outcomeId).toMatch(/^deny-/);
    }
  });

  it("refuses to execute without approval", async () => {
    const ctx = setup();
    const j = ctx.planner.plan("unsigned", "USD", [{ title: "x", price: "1.00" }]);
    await expect(executeJourney(j, ctx.journal, ctx.enforcer)).rejects.toThrow(/not approved/);
  });
});
