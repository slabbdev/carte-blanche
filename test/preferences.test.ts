import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PreferenceStore } from "../src/agent/preferences.js";
import { Journal } from "../src/journal/journal.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";

function setup() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "prefs-test-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  return { journal, prefs: new PreferenceStore(stateDir, journal), stateDir };
}

describe("agent preferences (journalled memory)", () => {
  it("sets, updates and recalls preferences — every change lands in the sealed chain", () => {
    const ctx = setup();
    ctx.prefs.set("hardware.tier", "high-end");
    ctx.prefs.set("hardware.tier", "mid-range", "principal corrected after a pricey pick");
    ctx.prefs.note("prefers Keychron-class vendors");

    const prefs = ctx.prefs.get();
    expect(prefs.preferences["hardware.tier"]).toBe("mid-range");
    expect(prefs.notes).toEqual(["prefers Keychron-class vendors"]);

    const events = ctx.journal.eventsFor((d) => String(d.key ?? "") === "hardware.tier");
    expect(events).toHaveLength(2);
    expect(events[0].data).toMatchObject({ previous: null, value: "high-end" });
    expect(events[1].data).toMatchObject({ previous: "high-end", value: "mid-range" });
    expect(ctx.journal.verify().ok).toBe(true);
  });

  it("persists across restarts", () => {
    const ctx = setup();
    ctx.prefs.set("merchants.trusted", "keychron.com");
    const reopened = new PreferenceStore(ctx.stateDir, ctx.journal);
    expect(reopened.get().preferences["merchants.trusted"]).toBe("keychron.com");
  });

  it("rejects empty keys and values", () => {
    const ctx = setup();
    expect(() => ctx.prefs.set("  ", "x")).toThrow(/key/);
    expect(() => ctx.prefs.set("k", " ")).toThrow(/value/);
  });
});
