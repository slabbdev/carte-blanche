import fs from "node:fs";
import { saveJson } from "../lib/persist.js";
import type { RevocationRecord, SignedMandate } from "./mandate.js";

interface PersistedState {
  mandates: SignedMandate[];
  revocations: RevocationRecord[];
}

/**
 * In-memory mandate store with JSON persistence. Holds signed mandates
 * (immutably: `put` rejects a second version of the same id — a mandate is
 * never edited, only revoked) and revocation state.
 */
export class MandateStore {
  private byId = new Map<string, SignedMandate>();
  private revocations = new Map<string, RevocationRecord>();

  constructor(private readonly file: string) {
    const state = loadState(file);
    for (const m of state.mandates) this.byId.set(m.mandate.id, m);
    for (const r of state.revocations) this.revocations.set(r.mandateId, r);
  }

  put(signed: SignedMandate): void {
    if (this.byId.has(signed.mandate.id)) {
      throw new Error(`mandate ${signed.mandate.id} already exists and mandates are immutable`);
    }
    this.byId.set(signed.mandate.id, signed);
    this.persist();
  }

  get(id: string): SignedMandate | undefined {
    return this.byId.get(id);
  }

  list(): SignedMandate[] {
    return [...this.byId.values()].sort((a, b) => (a.mandate.issuedAt < b.mandate.issuedAt ? 1 : -1));
  }

  isRevoked(id: string): boolean {
    return this.revocations.has(id);
  }

  revoke(id: string, reason: string): RevocationRecord | undefined {
    if (!this.byId.has(id)) return undefined;
    const existing = this.revocations.get(id);
    if (existing) return existing;
    const record: RevocationRecord = { mandateId: id, revokedAt: new Date().toISOString(), reason };
    this.revocations.set(id, record);
    this.persist();
    return record;
  }

  revocationOf(id: string): RevocationRecord | undefined {
    return this.revocations.get(id);
  }

  private persist(): void {
    const state: PersistedState = {
      mandates: [...this.byId.values()],
      revocations: [...this.revocations.values()],
    };
    saveJson(this.file, state);
  }
}

function loadState(file: string): PersistedState {
  try {
    if (!fs.existsSync(file)) return { mandates: [], revocations: [] };
    return JSON.parse(fs.readFileSync(file, "utf8")) as PersistedState;
  } catch {
    return { mandates: [], revocations: [] };
  }
}
