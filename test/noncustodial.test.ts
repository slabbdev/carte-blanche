import { describe, expect, it } from "vitest";
import { webcrypto as crypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "../src/lib/canonical.js";
import { verifyCanonical } from "../src/lib/sign.js";
import { validateMandate, newMandateId, type Mandate, type SignedMandate } from "../src/mandate/mandate.js";
import { MandateStore } from "../src/mandate/store.js";
import { Journal } from "../src/journal/journal.js";
import { loadOrCreateKeys } from "../src/lib/keys.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";
import { verifyFullReceipt } from "../src/receipts/receipts.js";

/**
 * Non-custodial mandates (S5): the PRINCIPAL signs in their own browser
 * (WebCrypto Ed25519) and the server only verifies. This test signs with a
 * key the server has never seen, exactly the way the browser does it —
 * crypto.subtle over canonical JSON — and runs the full loop.
 */

const bytesToB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function browserStyleKeypair() {
  const kp = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const pubSpki = bytesToB64(new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)));
  return { kp, pubSpki };
}

async function browserStyleSign(kp: CryptoKeyPair, payload: unknown): Promise<string> {
  const sig = await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(canonicalJson(payload)));
  return bytesToB64(new Uint8Array(sig));
}

function sampleMandate(): Mandate {
  return {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: "sam (browser)",
    agent: "shopping-agent-1",
    purpose: "signed in the browser with my own key",
    limits: {
      currency: "USD",
      maxPerTransaction: "30.00",
      maxTotalSpend: "60.00",
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date(Date.now() + 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
}

describe("non-custodial mandates (principal-held keys)", () => {
  it("verifies a browser-signed mandate the server has never seen — and rejects tampering", async () => {
    const { kp, pubSpki } = await browserStyleKeypair();
    const mandate = sampleMandate();
    const signature = await browserStyleSign(kp, mandate);

    expect(validateMandate(mandate)).toEqual([]);
    expect(verifyCanonical(pubSpki, mandate, signature)).toBe(true);
    // tamper ONE field after signing:
    const tampered: Mandate = { ...mandate, limits: { ...mandate.limits, maxTotalSpend: "990.00" } };
    expect(verifyCanonical(pubSpki, tampered, signature)).toBe(false);
    // wrong key:
    const stranger = await browserStyleKeypair();
    expect(verifyCanonical(stranger.pubSpki, mandate, signature)).toBe(false);
  });

  it("the full loop works under a principal-held key: purchase -> receipt verifies", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "noncustodial-"));
    const keys = loadOrCreateKeys(path.join(stateDir, "keys"));
    const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
    const store = new MandateStore(path.join(stateDir, "mandates.json"));
    const enforcer = new Enforcer(journal, store, new MockRails(), keys, stateDir);

    const { kp, pubSpki } = await browserStyleKeypair();
    const mandate = sampleMandate();
    const signed: SignedMandate = {
      mandate,
      signature: await browserStyleSign(kp, mandate),
      publicKey: pubSpki,
    };
    store.put(signed);

    const outcome = await enforcer.purchase({
      mandateId: mandate.id,
      amount: "25.00",
      currency: "USD",
      description: "bought under the principal's own key",
      payee: "store@example.com",
    });
    expect(outcome.kind).toBe("receipt");
    if (outcome.kind !== "receipt") return;
    const report = verifyFullReceipt(outcome.full);
    expect(report.overall).toBe(true);
    // the receipt's mandate signature is the PRINCIPAL's, not the server's:
    expect(outcome.full.mandatePublicKey).toBe(pubSpki);
    expect(outcome.full.mandatePublicKey).not.toBe(keys.server.publicKeyB64);
  });
});
