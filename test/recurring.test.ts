import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addPeriodsMs,
  newMandateId,
  recurrenceWindow,
  validateMandate,
  type Mandate,
} from "../src/mandate/mandate.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";

function setup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "recurring-test-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  return { stateDir, journal, store, keys };
}

describe("recurrence windows", () => {
  const base = new Date("2026-01-31T12:00:00Z").getTime(); // month-end anchor: clamping matters

  it("adds calendar months with day-of-month clamping (Jan 31 -> Feb 28, not Mar 3)", () => {
    expect(new Date(addPeriodsMs(base, "monthly", 1)).toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(new Date(addPeriodsMs(base, "monthly", 2)).toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(new Date(addPeriodsMs(base, "weekly", 1)).getTime()).toBe(base + 7 * 24 * 3_600_000);
  });

  it("slices the mandate into consecutive windows and clamps the last one to the horizon", () => {
    const limits = {
      currency: "USD",
      maxPerTransaction: "60.00",
      maxTotalSpend: "240.00",
      recurrence: { frequency: "monthly" as const, maxPerWindow: "40.00" },
      windowStart: new Date(base).toISOString(),
      windowEnd: new Date(addPeriodsMs(base, "monthly", 3)).toISOString(),
    };
    const w0 = recurrenceWindow(limits, base + 1)!;
    expect(w0.index).toBe(0);
    const w1 = recurrenceWindow(limits, addPeriodsMs(base, "monthly", 1) + 1)!;
    expect(w1.index).toBe(1);
    expect(w1.startMs).toBe(addPeriodsMs(base, "monthly", 1));
    // anything past the horizon -> no window at all
    expect(recurrenceWindow(limits, addPeriodsMs(base, "monthly", 3) + 1)).toBeUndefined();
  });

  it("validates the recurrence field", () => {
    const mk = (recurrence: unknown): Mandate => ({
      id: newMandateId(),
      version: "cb-mandate/v1",
      principal: "p",
      agent: "a",
      purpose: "x",
      limits: {
        currency: "USD",
        maxPerTransaction: "10.00",
        maxTotalSpend: "100.00",
        ...(recurrence as never),
        windowStart: new Date().toISOString(),
        windowEnd: new Date(Date.now() + 3_600_000).toISOString(),
      },
      issuedAt: new Date().toISOString(),
    });
    expect(validateMandate(mk(undefined))).toEqual([]);
    expect(validateMandate(mk({ recurrence: { frequency: "monthly", maxPerWindow: "40.00" } }))).toEqual([]);
    expect(validateMandate(mk({ recurrence: { frequency: "daily", maxPerWindow: "40.00" } }))).toHaveLength(1);
    expect(validateMandate(mk({ recurrence: { frequency: "monthly", maxPerWindow: "abc" } }))).toHaveLength(1);
  });
});

describe("recurring enforcement", () => {
  it("enforces the per-window cap, resets next window, and the mandate-wide cap still stands last", async () => {
    const ctx = setup();
    let clockMs = Date.now() - 60_000;
    const enforcer = new Enforcer(ctx.journal, ctx.store, new MockRails(), ctx.keys, ctx.stateDir, {
      now: () => clockMs,
    });
    const start = clockMs;
    const signed = signMandate(
      {
        id: newMandateId(),
        version: "cb-mandate/v1",
        principal: "p",
        agent: "a",
        purpose: "groceries $40/month",
        limits: {
          currency: "USD",
          maxPerTransaction: "60.00",
          maxTotalSpend: "60.00",
          recurrence: { frequency: "monthly", maxPerWindow: "40.00" },
          windowStart: new Date(start).toISOString(),
          windowEnd: new Date(addPeriodsMs(start, "monthly", 2)).toISOString(),
        },
        issuedAt: new Date(start).toISOString(),
      },
      ctx.keys.server.privateKeyB64,
      ctx.keys.server.publicKeyB64,
    );
    ctx.store.put(signed);
    const id = signed.mandate.id;
    let seq = 0;
    const buy = (amount: string) =>
      // unique description per attempt: identical requests share a logicalKey
      // by design (retry idempotency), which would memo-hit across windows
      enforcer.purchase({ mandateId: id, amount, currency: "USD", description: `x-${++seq}` });

    // month 0: 25 ok, 30 would be 55 > 40 -> window wall
    expect((await buy("25.00")).kind).toBe("receipt");
    const w0 = (await buy("30.00")) as { kind: string; denial?: { reasonCode: string; reasonDetail: string } };
    expect(w0.kind).toBe("denial");
    expect(w0.denial?.reasonCode).toBe("OVER_WINDOW_CAP");
    expect(w0.denial?.reasonDetail).toMatch(/window #0/);

    // month 1: window reset — the same amounts pass again under the SAME mandate
    clockMs = addPeriodsMs(start, "monthly", 1) + 3_600_000;
    expect((await buy("35.00")).kind).toBe("receipt"); // window 35 ≤ 40, total exactly 60

    // window passes (35+5 = 40 exactly at cap) but the mandate-wide cap trips: 60+5 > 60
    const w1 = (await buy("5.00")) as { kind: string; denial?: { reasonCode: string } };
    expect(w1.kind).toBe("denial");
    expect(w1.denial?.reasonCode).toBe("OVER_TOTAL_CAP");

    // spend accounting comes straight from the chain
    expect(ctx.journal.capturedMinorFor(id)).toBe(6000n);
    const win1 = recurrenceWindow(signed.mandate.limits, clockMs)!;
    expect(ctx.journal.capturedMinorFor(id, { fromMs: win1.startMs, toMs: win1.endMs })).toBe(3500n);
  });

  it("non-recurring mandates behave exactly as before (no window wall)", async () => {
    const ctx = setup();
    const enforcer = new Enforcer(ctx.journal, ctx.store, new MockRails(), ctx.keys, ctx.stateDir);
    const start = Date.now() - 60_000;
    const signed = signMandate(
      {
        id: newMandateId(),
        version: "cb-mandate/v1",
        principal: "p",
        agent: "a",
        purpose: "plain",
        limits: {
          currency: "USD",
          maxPerTransaction: "60.00",
          maxTotalSpend: "50.00",
          windowStart: new Date(start).toISOString(),
          windowEnd: new Date(start + 3_600_000).toISOString(),
        },
        issuedAt: new Date(start).toISOString(),
      },
      ctx.keys.server.privateKeyB64,
      ctx.keys.server.publicKeyB64,
    );
    ctx.store.put(signed);
    const r1 = await enforcer.purchase({ mandateId: signed.mandate.id, amount: "30.00", currency: "USD", description: "a" });
    const r2 = await enforcer.purchase({ mandateId: signed.mandate.id, amount: "15.00", currency: "USD", description: "b" });
    expect(r1.kind).toBe("receipt");
    expect(r2.kind).toBe("receipt"); // 45 total < 50, and no recurrence to trip on
  });
});

describe("recurring journeys", async () => {
  it("re-runs the same approved basket in a new cycle with cycle-scoped logical keys", async () => {
    const { JourneyPlanner, executeJourney } = await import("../src/journey/journey.js");
    const ctx = setup();
    let clockMs = Date.now() - 60_000;
    const enforcer = new Enforcer(ctx.journal, ctx.store, new MockRails(), ctx.keys, ctx.stateDir, {
      now: () => clockMs,
    });
    const planner = new JourneyPlanner(ctx.stateDir, ctx.journal);
    const planned = planner.plan("monthly basket", "USD", [{ title: "beans", merchant: "grocer.example", price: "20.00" }]);
    const start = clockMs;
    const signed = signMandate(
      {
        id: newMandateId(),
        version: "cb-mandate/v1",
        principal: "p",
        agent: "a",
        purpose: "monthly basket",
        limits: {
          currency: "USD",
          maxPerTransaction: "20.00",
          maxTotalSpend: "40.00",
          recurrence: { frequency: "monthly", maxPerWindow: "20.00" },
          windowStart: new Date(start).toISOString(),
          windowEnd: new Date(addPeriodsMs(start, "monthly", 2)).toISOString(),
        },
        issuedAt: new Date(start).toISOString(),
      },
      ctx.keys.server.privateKeyB64,
      ctx.keys.server.publicKeyB64,
    );
    ctx.store.put(signed);
    const j = planner.markApproved(planned.id, signed.mandate.id, { frequency: "monthly" })!;

    const cycle1 = await executeJourney(j, ctx.journal, enforcer, { cycle: "2026-01" });
    expect(cycle1.items[0].status).toBe("receipt");
    expect(cycle1.cyclesRun).toEqual(["2026-01"]);
    // executeJourney mutates and returns the SAME journey object — snapshot
    // cycle 1's outcome now or the assertion would read cycle 2's value.
    const firstReceiptId = cycle1.items[0].outcomeId;

    // next month: same mandate, same lines — the cycle key keeps retries idempotent per period
    clockMs = addPeriodsMs(start, "monthly", 1) + 3_600_000;
    const cycle2 = await executeJourney(j, ctx.journal, enforcer, { cycle: "2026-02" });
    expect(cycle2.items[0].status).toBe("receipt");
    expect(cycle2.items[0].outcomeId).not.toBe(firstReceiptId);
    expect(cycle2.cyclesRun).toEqual(["2026-01", "2026-02"]);
    expect(ctx.journal.capturedMinorFor(signed.mandate.id)).toBe(4000n); // 2 windows × $20

    // re-running the SAME cycle replays (idempotent), never double-spends
    const replay = await executeJourney(j, ctx.journal, enforcer, { cycle: "2026-02" });
    expect(replay.items[0].outcomeId).toBe(cycle2.items[0].outcomeId);
    expect(ctx.journal.capturedMinorFor(signed.mandate.id)).toBe(4000n);

    // bad cycle key is rejected before any attempt
    await expect(executeJourney(j, ctx.journal, enforcer, { cycle: "january" })).rejects.toThrow(/YYYY-MM/);
  });
});

describe("price drops apply to the basket (the promo story)", () => {
  it("applyPriceDrop re-prices watching lines; a drop-scoped re-run buys at the NEW price exactly once", async () => {
    const { JourneyPlanner, executeJourney } = await import("../src/journey/journey.js");
    const ctx = setup();
    const enforcer = new Enforcer(ctx.journal, ctx.store, new MockRails(), ctx.keys, ctx.stateDir);
    const planner = new JourneyPlanner(ctx.stateDir, ctx.journal);
    const planned = planner.plan("deal basket", "USD", [{ title: "PS5", merchant: "bjs.com", price: "499.00" }]);
    const signed = signMandate({
      id: newMandateId(), version: "cb-mandate/v1", principal: "p", agent: "a", purpose: "deal basket",
      limits: { currency: "USD", maxPerTransaction: "600.00", maxTotalSpend: "1200.00",
        windowStart: new Date(Date.now() - 60000).toISOString(), windowEnd: new Date(Date.now() + 3.6e6).toISOString() },
      issuedAt: new Date().toISOString(),
    }, ctx.keys.server.privateKeyB64, ctx.keys.server.publicKeyB64);
    ctx.store.put(signed);
    const j = planner.markApproved(planned.id, signed.mandate.id)!;
    j.items[0].productId = "ps5canon";

    const first = await executeJourney(j, ctx.journal, enforcer);
    expect(first.items[0].status).toBe("receipt");
    expect(first.items[0].price).toBe("499.00");

    // the drop lands: watching lines re-price + journal the update
    const changes = planner.applyPriceDrop("ps5canon", "399.00");
    expect(changes).toHaveLength(1);
    expect(changes[0].oldPrice).toBe("499.00");
    expect(j.items[0].price).toBe("399.00");
    expect(ctx.journal.eventsOfType("journey_line_price_updated")).toHaveLength(1);

    // drop-scoped re-run: new logical key, new purchase at the NEW price
    const second = await executeJourney(j, ctx.journal, enforcer, { cycle: "2026-10", keySuffix: "drop42" });
    expect(second.items[0].status).toBe("receipt");
    expect(second.items[0].price).toBe("399.00");
    expect(ctx.journal.capturedMinorFor(signed.mandate.id)).toBe(49900n + 39900n);

    // re-clicking the SAME drop replays the same logical purchase — no double spend
    await executeJourney(j, ctx.journal, enforcer, { cycle: "2026-10", keySuffix: "drop42" });
    expect(ctx.journal.capturedMinorFor(signed.mandate.id)).toBe(49900n + 39900n);
    expect(ctx.journal.eventsOfType("journey_line_price_updated")).toHaveLength(1);
  });
});
