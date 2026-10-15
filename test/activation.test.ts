import { describe, expect, it } from "vitest";
import { setupWorld } from "./helpers.js";
import { createHash } from "node:crypto";
import { buildEvidencePack, toMarkdown } from "../src/disputes/evidence.js";
import { DisputeService } from "../src/disputes/service.js";

describe("sealed activation (the buyer's words)", () => {
  it("journals the prompt at purchase time, stamps the receipt, and arms the evidence pack", async () => {
    const w = setupWorld();
    const utterance = "Achète-moi la PS5 Slim chez bestbuy, max 550 dollars";
    const p = await w.enforcer.purchase({
      mandateId: w.mandateId, amount: "25.00", currency: "USD",
      description: "PS5 Slim", logicalKey: "act-1",
      intent: { text: utterance, channel: "chatgpt", sessionRef: "conv-42" },
    });
    expect(p.kind).toBe("receipt");
    if (p.kind !== "receipt") return;

    // hash on the receipt = sha256 of the FULL raw utterance
    expect(p.receipt.intent?.hash).toBe(createHash("sha256").update(utterance.trim()).digest("hex"));
    expect(p.receipt.intent?.channel).toBe("chatgpt");

    // the journal sealed it at purchase time
    const fired = w.journal.eventsOfType("purchase_requested").find((e) => (e.data as any).activation);
    expect(fired).toBeDefined();
    expect((fired!.data as any).activation.text_hash).toBe(p.receipt.intent!.hash);

    // the evidence pack carries the buyer's words + the hash
    const svc = new DisputeService({ railsMode: "mock", enforcer: w.enforcer, journal: w.journal });
    const d = (await svc.list()).find((x) => x.linkedReceiptId === p.receipt.receiptId);
    if (!d) throw new Error("no dispute row");
    const pack = buildEvidencePack({ ...d, linkedReceiptId: p.receipt.receiptId }, { enforcer: w.enforcer, journal: w.journal, store: w.store });
    expect(pack.activation?.hash).toBe(p.receipt.intent!.hash);
    const md = toMarkdown(pack);
    expect(md).toContain(utterance);
    expect(md).toMatch(/sealed words/);
    expect(md).toContain("disown BOTH");
  });

  it("purchases without intent stay valid (the field is optional)", async () => {
    const w = setupWorld();
    const p = await w.enforcer.purchase({ mandateId: w.mandateId, amount: "10.00", currency: "USD", description: "no intent" });
    expect(p.kind).toBe("receipt");
    if (p.kind !== "receipt") return;
    expect(p.receipt.intent).toBeUndefined();
  });
});
