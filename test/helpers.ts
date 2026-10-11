import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPair, type KeyPair } from "../src/lib/sign.js";
import { Journal } from "../src/journal/journal.js";
import { MandateStore } from "../src/mandate/store.js";
import { newMandateId, type Mandate } from "../src/mandate/mandate.js";
import { signMandate } from "../src/mandate/signing.js";
import { MockRails } from "../src/paypal/adapter.js";
import { Enforcer } from "../src/enforcer/enforcer.js";
import type { TsaClient } from "../src/journal/tsa.js";
import type { Keys } from "../src/lib/keys.js";

export interface World {
  enforcer: Enforcer;
  journal: Journal;
  store: MandateStore;
  mock: MockRails;
  keys: Keys;
  mandateId: string;
  stateDir: string;
}

export function freshKeys(): Keys {
  return { server: generateKeyPair(), journal: generateKeyPair() };
}

export function makeMandate(
  keys: Keys,
  limits: Partial<Mandate["limits"]> = {},
  extra: { principal?: string; agent?: string; purpose?: string } = {},
): { mandate: Mandate } {
  const now = Date.now();
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: extra.principal ?? "test-principal",
    agent: extra.agent ?? "test-agent",
    purpose: extra.purpose ?? "tests",
    limits: {
      currency: "USD",
      maxPerTransaction: "30.00",
      maxTotalSpend: "60.00",
      windowStart: new Date(now - 60_000).toISOString(),
      windowEnd: new Date(now + 7 * 86_400_000).toISOString(),
      ...limits,
    },
    issuedAt: new Date(now - 30_000).toISOString(),
  };
  void keys;
  return { mandate };
}

export function setupWorld(limits: Partial<Mandate["limits"]> = {}, tsa?: TsaClient): World {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-test-"));
  const keys = freshKeys();
  const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);
  const store = new MandateStore(path.join(stateDir, "mandates.json"));
  const mock = new MockRails();
  const enforcer = new Enforcer(journal, store, mock, keys, stateDir, tsa ? { tsa } : undefined);
  const { mandate } = makeMandate(keys, limits);
  store.put(signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64));
  return { enforcer, journal, store, mock, keys, mandateId: mandate.id, stateDir };
}

export function keyPair(): KeyPair {
  return generateKeyPair();
}
