/**
 * Agent passports — the "who is this agent" layer, integrated.
 *
 * Inspired by the Trust Gateway pattern (passport + power of attorney): the
 * mandate is the power of attorney (user-signed); the passport binds a
 * SPECIFIC agent instance to it via an Ed25519 keypair. Purchases signed by
 * the passport prove possession — "which software instance executed this".
 *
 * DID method: did:cb:ed25519:<fingerprint> — self-certifying from the public
 * key (same idea as did:key, Carte Blanche namespace).
 */
import { generateKeyPairSync, createHash, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface AgentPassport {
  agentId: string;
  did: string;
  publicKeyB64: string;
  fingerprint: string;
  createdAt: string;
}

interface Stored extends AgentPassport {
  /** Present only when the server generated the keypair — returned ONCE. */
  secretKeyB64?: string;
}

export const passportMessage = (logicalKey: string, ts: string) => `cb-agent-proof:${logicalKey}:${ts}`;

export function didForPublicKey(publicKeyB64: string): string {
  const fp = createHash("sha256").update(publicKeyB64, "base64").digest("hex").slice(0, 24);
  return `did:cb:ed25519:${fp}`;
}

export class AgentPassportStore {
  private passports = new Map<string, Stored>();

  constructor(private readonly file: string) {
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, "utf8")) as { passports: Stored[] };
        for (const p of raw.passports ?? []) this.passports.set(p.agentId, p);
      }
    } catch { /* fresh start */ }
  }

  private persist() {
    writeFileSync(this.file, JSON.stringify({ passports: [...this.passports.values()] }, null, 2));
  }

  /**
   * Register an agent. Without publicKeyB64 the server generates the Ed25519
   * keypair and returns the secret EXACTLY once — the agent keeps it; the
   * server keeps only the public passport. With publicKeyB64 the agent brings
   * its own key (self-certifying, server never sees the secret).
   */
  register(input: { agentId?: string; publicKeyB64?: string; owner?: string }): {
    passport: AgentPassport; secretKeyB64?: string;
  } {
    const agentId = (input.agentId?.trim() || `agent-${createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 8)}`).slice(0, 64);
    let publicKeyB64: string;
    let secretKeyB64: string | undefined;

    if (input.publicKeyB64) {
      publicKeyB64 = String(input.publicKeyB64);
      // sanity: must be a valid base64 SPKI public key
      createHash("sha256").update(publicKeyB64, "base64").digest(); // throws on bad base64
    } else {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      publicKeyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
      secretKeyB64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    }

    const did = didForPublicKey(publicKeyB64);
    const passport: Stored = {
      agentId, did, publicKeyB64,
      fingerprint: createHash("sha256").update(publicKeyB64, "base64").digest("hex").slice(0, 16),
      createdAt: new Date().toISOString(),
      ...(input.owner ? { owner: String(input.owner).slice(0, 64) } : {}),
      ...(secretKeyB64 ? { secretKeyB64 } : {}),
    };
    this.passports.set(agentId, passport);
    this.persist();
    const { secretKeyB64: secret, ...pub } = passport;
    return { passport: pub, ...(secret ? { secretKeyB64: secret } : {}) };
  }

  get(agentId: string): AgentPassport | undefined {
    const p = this.passports.get(agentId);
    if (!p) return undefined;
    const { secretKeyB64, ...pub } = p;
    return pub;
  }

  list(): AgentPassport[] {
    return [...this.passports.values()].map(({ secretKeyB64, ...pub }) => pub);
  }

  /** Proof-of-possession: the agent signs cb-agent-proof:<logicalKey>:<ts>. */
  verifyProof(agentId: string, logicalKey: string, ts: string, signatureB64: string): boolean {
    const p = this.passports.get(agentId);
    if (!p) return false;
    try {
      const pub = createPublicKey({ key: Buffer.from(p.publicKeyB64, "base64"), format: "der", type: "spki" });
      return edVerify(null, Buffer.from(passportMessage(logicalKey, ts)), pub, Buffer.from(signatureB64, "base64"));
    } catch {
      return false;
    }
  }
}
