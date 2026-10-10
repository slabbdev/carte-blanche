import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshKeys } from "./helpers.js";
import { Journal } from "../src/journal/journal.js";

function tempJournal(): { journal: Journal; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-journal-"));
  const file = path.join(dir, "journal.jsonl");
  const keys = freshKeys();
  return { journal: new Journal(file, keys.journal), file };
}

describe("Journal", () => {
  it("chains events and verifies", () => {
    const { journal } = tempJournal();
    journal.append("a", { n: 1 });
    journal.append("b", { n: 2 });
    journal.append("c", { n: 3 });
    const v = journal.verify();
    expect(v.ok).toBe(true);
    expect(v.length).toBe(3);
    const events = journal.recent(10).reverse();
    expect(events[1].prevHash).toBe(events[0].hash);
    expect(events[2].prevHash).toBe(events[1].hash);
    expect(journal.tip()).toBe(events[2].hash);
  });

  it("detects tampering and locates the break", () => {
    const { journal, file } = tempJournal();
    journal.append("a", { n: 1 });
    journal.append("b", { n: 2 });
    // rewrite the file with mutated data for event 1 (as an attacker would)
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    lines[1].data = { n: 999 };
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const keys = freshKeys();
    void keys;
    // reload from disk
    const reloaded = new Journal(file, freshKeys().journal);
    const v = reloaded.verify();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });

  it("survives a torn trailing line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-journal-"));
    const file = path.join(dir, "journal.jsonl");
    const { journal } = { journal: new Journal(file, freshKeys().journal) };
    journal.append("a", { n: 1 });
    fs.appendFileSync(file, '{"seq":2,"ts":"x","type":"b","data":{},"prevHas'); // torn write
    const reloaded = new Journal(file, freshKeys().journal);
    expect(reloaded.length).toBe(1);
    expect(reloaded.verify().ok).toBe(true);
  });

  it("sums captured spend per mandate from the chain", () => {
    const { journal } = tempJournal();
    journal.append("order_captured", { mandate_id: "m1", amount_minor: "2500" });
    journal.append("order_captured", { mandate_id: "m1", amount_minor: "1000" });
    journal.append("order_captured", { mandate_id: "m2", amount_minor: "500" });
    journal.append("purchase_denied", { mandate_id: "m1", reason_code: "OVER_TOTAL_CAP" });
    expect(journal.capturedMinorFor("m1")).toBe(3500n);
    expect(journal.capturedMinorFor("m2")).toBe(500n);
    expect(journal.capturedMinorFor("unknown")).toBe(0n);
  });
});
