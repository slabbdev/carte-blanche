import { describe, expect, it } from "vitest";
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { setupWorld } from "./helpers.js";
import { AgentPassportStore, passportMessage } from "../src/agent/passport.js";

describe("agent passports (who is this agent — integrated)", () => {
  it("verifies proof-of-possession and stamps the receipt with the passport DID", async () => {
    const w = setupWorld();
    const store: AgentPassportStore = (w as any).passports;

    // register: server generates the keypair, returns the secret ONCE
    const { passport, secretKeyB64 } = store.register({ agentId: "shopping-agent-1" });
    expect(passport.did).toMatch(/^did:cb:ed25519:/);
    expect(secretKeyB64).toBeTruthy();

    // re-registering with the same public key never re-leaks a secret
    const again = store.register({ agentId: "shopping-agent-1", publicKeyB64: passport.publicKeyB64 });
    expect(again.secretKeyB64).toBeUndefined();

    // the buyer's agent signs cb-agent-proof:<logicalKey>:<ts> with its key
    const ts = new Date().toISOString();
    const priv = createPrivateKey({ key: Buffer.from(secretKeyB64!, "base64"), format: "der", type: "pkcs8" });
    const sig = edSign(null, Buffer.from(passportMessage("pp-1", ts)), priv).toString("base64");

    const p = await w.enforcer.purchase({
      mandateId: w.mandateId, amount: "25.00", currency: "USD",
      description: "passport purchase", logicalKey: "pp-1",
      agentProof: { agentId: "shopping-agent-1", signature: sig, ts },
    });
    expect(p.kind).toBe("receipt");
    if (p.kind !== "receipt") return;
    expect(p.receipt.agent?.passportId).toBe("shopping-agent-1");
    expect(p.receipt.agent?.did).toBe(passport.did);

    // a FORGED signature is refused with a signed denial
    const bad = await w.enforcer.purchase({
      mandateId: w.mandateId, amount: "10.00", currency: "USD",
      description: "forged agent", logicalKey: "pp-2",
      agentProof: { agentId: "shopping-agent-1", signature: "AAAA", ts: new Date().toISOString() },
    });
    expect(bad.kind).toBe("denial");
    if (bad.kind !== "denial") return;
    expect(bad.denial.reasonCode).toBe("MANDATE_TAMPERED");
    expect(bad.denial.reasonDetail).toMatch(/passport proof invalid/);
  });

  it("hash consistency: did derives from the public key fingerprint", () => {
    const w = setupWorld();
    const store: AgentPassportStore = (w as any).passports;
    const { passport } = store.register({ agentId: "did-check" });
    const fp = createHash("sha256").update(passport.publicKeyB64, "base64").digest("hex").slice(0, 24);
    expect(passport.did).toBe(`did:cb:ed25519:${fp}`);
  });
});
