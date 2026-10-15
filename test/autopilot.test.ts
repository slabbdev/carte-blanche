import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureAutopilot, runScriptedPolicy } from "../src/agent/autopilot.js";
import { Channel3Catalog, type CatalogTransport } from "../src/catalog/channel3.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { signMandate } from "../src/mandate/signing.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";

const RAW = {
  products: [
    {
      id: "p1", title: "Keychron V6",
      offers: [{ price: { price: 49.99, currency: "USD" }, domain: "keychron.com", url: "https://buy.example/1" }],
      images: [],
    },
    {
      id: "p2", title: "Cheap Off-List Board",
      offers: [{ price: { price: 19.99, currency: "USD" }, domain: "offgrid.example" }],
      images: [],
    },
  ],
};

function transportWith(products: unknown[]): CatalogTransport {
  return { async post() { return { status: 200, json: { products } }; } };
}

function setup(allowlist: string[]) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-"));
  const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);
  const catalog = new Channel3Catalog("key", transportWith(RAW.products));
  configureAutopilot(journal, catalog, store, "http://localhost:8790");

  const mandate: Mandate = {
    id: newMandateId(), version: "cb-mandate/v1",
    principal: "p", agent: "a1", purpose: "autopilot fixture",
    limits: { currency: "USD", maxPerTransaction: "60.00", maxTotalSpend: "60.00",
      ...(allowlist.length ? { payees: allowlist } : {}),
      windowStart: new Date(Date.now() - 60_000).toISOString(), windowEnd: new Date(Date.now() + 3_600_000).toISOString() },
    issuedAt: new Date().toISOString(),
  };
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  return { journal, enforcer, store, catalog, mandateId: mandate.id };
}

describe("autopilot (server-side agent run)", () => {
  it("scripted policy buys the cheapest in-allowlist offer that fits", async () => {
    const ctx = setup(["keychron.com"]);
    const r = await runScriptedPolicy(ctx.enforcer, { mandateId: ctx.mandateId, goal: "mechanical keyboard" });
    expect(r.mode).toBe("scripted");
    expect(r.outcome).toBe("receipt");
    expect(r.artifactId).toMatch(/^rcpt-/);
    expect(r.steps.some((s) => s.action === "pick" && s.detail.includes("keychron.com"))).toBe(true);
    const runs = ctx.journal.eventsFor((d) => typeof d.goal === "string" && d.mode === "scripted");
    expect(runs).toHaveLength(1);
  });

  it("an off-list-only catalog still gets attempted — and the wall refuses with proof", async () => {
    const ctx = setup(["keychron.com"]);
    configureAutopilot(ctx.journal, new Channel3Catalog("key", transportWith([RAW.products[1]])), ctx.store, "http://localhost:8790");

    const r = await runScriptedPolicy(ctx.enforcer, { mandateId: ctx.mandateId, goal: "keyboard" });
    expect(r.outcome).toBe("refused");
    expect(r.artifactId).toMatch(/^deny-/);
    expect(r.steps.at(-1)?.detail).toMatch(/PAYEE_NOT_ALLOWED/);
  });
});
