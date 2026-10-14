import { signCanonical, verifyCanonical } from "../lib/sign.js";
import { formatAmount } from "../mandate/mandate.js";
import type { Journal } from "../journal/journal.js";

/**
 * Agent track record: the agent's verifiable reputation, computed from the
 * sealed journal — nothing self-reported. The insight it operationalizes: in
 * agent commerce, a signed refusal is not just a blocked call, it is the raw
 * material of agent reputation. Merchants need to know "does this agent honor
 * its walls" before accepting agent orders; buyers need it before delegating
 * spending. The honest core of this statement is structural: the enforcer has
 * NO override path — a refusal is cryptographically final, so obedience is
 * architectural, not a behavioral promise.
 */

export interface TrackRecord {
  agent: string;
  window: { from: string; to: string };
  mandatesIssued: number;
  purchasesCaptured: number;
  /** Total captured spend per currency (minor-unit exact, formatted). */
  captured: Array<{ currency: string; amount: string }>;
  /** Refusals by reason code — each one is a wall that held, signed. */
  refusals: Array<{ code: string; count: number }>;
  /** Structural guarantee, stated plainly: there is no bypass path. */
  guarantee: string;
}

export interface SignedTrackStatement extends TrackRecord {
  statement: {
    signedAt: string;
    /** sha256 chain tip the counts are committed to. */
    chainTip: string;
    journalLength: number;
    signature: string;
    publicKey: string;
  };
}

export function computeTrackRecord(agent: string, journal: Journal): Omit<SignedTrackStatement, "statement"> & {
  window: { from: string; to: string };
} {
  const events = journal.eventsFor(() => true);
  const from = events[0]?.ts ?? new Date().toISOString();
  const to = events[events.length - 1]?.ts ?? from;

  // mandate -> agent, from issuance events (the only place authority is granted)
  const agentOf = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "mandate_issued") continue;
    const d = e.data as { mandate_id?: string; agent?: string };
    if (d.mandate_id && d.agent) agentOf.set(d.mandate_id, d.agent);
  }
  const isForAgent = (mandateId: unknown) =>
    typeof mandateId === "string" && agentOf.get(mandateId) === agent;

  let mandatesIssued = 0;
  let purchasesCaptured = 0;
  const capturedMinor = new Map<string, bigint>();
  const refusalsByCode = new Map<string, number>();

  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case "mandate_issued":
        if (d.agent === agent) mandatesIssued++;
        break;
      case "order_captured":
        if (!isForAgent(d.mandate_id)) break;
        purchasesCaptured++;
        {
          const currency = String(d.currency ?? "USD");
          const minor = BigInt(String(d.amount_minor ?? "0"));
          capturedMinor.set(currency, (capturedMinor.get(currency) ?? 0n) + minor);
        }
        break;
      case "purchase_denied":
        if (!isForAgent(d.mandate_id)) break;
        {
          const code = String(d.reason_code ?? "UNKNOWN");
          refusalsByCode.set(code, (refusalsByCode.get(code) ?? 0) + 1);
        }
        break;
    }
  }

  const captured = [...capturedMinor.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, minor]) => ({ currency, amount: formatAmount(minor, currency) }));
  const refusals = [...refusalsByCode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, count]) => ({ code, count }));

  return {
    agent,
    window: { from, to },
    mandatesIssued,
    purchasesCaptured,
    captured,
    refusals,
    guarantee:
      "Every refusal recorded here is cryptographically final: the agent has no bypass path — " +
      "each attempt goes through the enforcer, and a denied attempt cannot be retried into a " +
      "different outcome (deterministic request ids + memoized logical keys). Obedience is " +
      "architectural, not behavioral.",
  };
}

export class TrackRecordService {
  constructor(
    private readonly journal: Journal,
    private readonly signingKey: { privateKeyB64: string; publicKeyB64: string },
  ) {}

  /** Compute + sign a portable statement over the journal's current position. */
  statementFor(agent: string): SignedTrackStatement {
    const record = computeTrackRecord(agent, this.journal);
    const payload = {
      ...record,
      chainTip: this.journal.tip(),
      journalLength: this.journal.length,
    };
    return {
      ...record,
      statement: {
        signedAt: new Date().toISOString(),
        chainTip: payload.chainTip,
        journalLength: payload.journalLength,
        signature: signCanonical(this.signingKey.privateKeyB64, payload),
        publicKey: this.signingKey.publicKeyB64,
      },
    };
  }

  /** Third-party verification of a statement — no trust in us required. */
  static verify(s: SignedTrackStatement): boolean {
    const payload = {
      agent: s.agent,
      window: s.window,
      mandatesIssued: s.mandatesIssued,
      purchasesCaptured: s.purchasesCaptured,
      captured: s.captured,
      refusals: s.refusals,
      guarantee: s.guarantee,
      chainTip: s.statement.chainTip,
      journalLength: s.statement.journalLength,
    };
    return verifyCanonical(s.statement.publicKey, payload, s.statement.signature);
  }
}
