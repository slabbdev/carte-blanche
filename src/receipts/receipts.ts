import { canonicalJson } from "../lib/canonical.js";
import { sha256Hex, signCanonical, verifyCanonical } from "../lib/sign.js";
import type { JournalEvent } from "../journal/journal.js";
import type { Mandate } from "../mandate/mandate.js";

/** A completed, journalled, signed purchase. */
export interface Receipt {
  receiptId: string;
  mandateId: string;
  logicalKey: string;
  createdAt: string;
  amount: string;
  currency: string;
  description: string;
  payee?: string;
  orderId: string;
  captureId: string;
  status: string;
  chainTip: string;
  journalLength: number;
}

/** A signed proof that a purchase attempt was REFUSED by the mandate. */
export interface Denial {
  denialId: string;
  mandateId: string;
  logicalKey: string;
  createdAt: string;
  requested: {
    amount: string;
    currency: string;
    payee?: string;
    description: string;
  };
  reasonCode: string;
  reasonDetail: string;
  chainTip: string;
  journalLength: number;
}

/**
 * A "full" artifact is the self-contained evidence bundle handed to the
 * verifier page and to dispute workflows: the receipt or denial, the mandate
 * it was issued under, both signatures, and the raw journal events that
 * document the operation end to end.
 */
export interface FullReceipt {
  receipt: Receipt;
  mandate: Mandate;
  mandateSignature: string;
  mandatePublicKey: string;
  events: JournalEvent[];
  receiptSignature: string;
  receiptPublicKey: string;
  railsMode: string;
}

export interface FullDenial {
  denial: Denial;
  /** Null only for refusals of unknown mandate ids (nothing to bundle). */
  mandate: Mandate | null;
  mandateSignature: string | null;
  mandatePublicKey: string | null;
  denialSignature: string;
  denialPublicKey: string;
  railsMode: string;
}

export interface VerificationReport {
  subject: "receipt" | "denial";
  id: string;
  checks: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
  overall: boolean;
}

export function signReceipt(receipt: Receipt, privateKeyB64: string): string {
  return signCanonical(privateKeyB64, receipt);
}

export function signDenial(denial: Denial, privateKeyB64: string): string {
  return signCanonical(privateKeyB64, denial);
}

export function newReceiptId(logicalKey: string): string {
  return `rcpt-${sha256Hex(logicalKey).slice(0, 16)}`;
}

export function newDenialId(logicalKey: string): string {
  return `deny-${sha256Hex(logicalKey).slice(0, 16)}`;
}

export function verifyFullReceipt(full: FullReceipt): VerificationReport {
  const checks: VerificationReport["checks"] = [];

  const mandateOk = verifyCanonical(full.mandatePublicKey, full.mandate, full.mandateSignature);
  checks.push({
    id: "mandate_signature",
    label: "Mandate signature (Ed25519) verifies",
    ok: mandateOk,
    detail: `signed by ${fingerprint(full.mandatePublicKey)}`,
  });

  const hashesOk =
    full.events.length > 0 &&
    full.events.every((e) => e.hash === sha256Hex(canonicalJson({ seq: e.seq, ts: e.ts, type: e.type, data: e.data, prevHash: e.prevHash })));
  checks.push({
    id: "event_hashes",
    label: `${full.events.length} journal event(s) re-hash to their recorded SHA-256`,
    ok: hashesOk,
  });

  const captured = full.events.find((e) => e.type === "order_captured");
  const linkOk =
    full.receipt.mandateId === full.mandate.id &&
    captured !== undefined &&
    (captured.data as Record<string, unknown>).order_id === full.receipt.orderId &&
    (captured.data as Record<string, unknown>).amount_minor === minorString(full.receipt.amount, full.receipt.currency);
  checks.push({
    id: "receipt_matches_events",
    label: "Receipt matches the journal events it claims",
    ok: linkOk,
    detail: captured ? `capture event seq ${captured.seq}` : "no order_captured event found",
  });

  const receiptOk = verifyCanonical(full.receiptPublicKey, full.receipt, full.receiptSignature);
  checks.push({
    id: "receipt_signature",
    label: "Receipt signature (Ed25519) verifies",
    ok: receiptOk,
    detail: `signed by ${fingerprint(full.receiptPublicKey)}`,
  });

  return { subject: "receipt", id: full.receipt.receiptId, checks, overall: checks.every((c) => c.ok) };
}

export function verifyFullDenial(full: FullDenial): VerificationReport {
  const checks: VerificationReport["checks"] = [];

  const mandateOk = full.mandate !== null && full.mandateSignature !== null &&
    verifyCanonical(full.mandatePublicKey ?? "", full.mandate, full.mandateSignature);
  checks.push({
    id: "mandate_signature",
    label: "Mandate signature (Ed25519) verifies",
    ok: mandateOk,
    detail: full.mandatePublicKey ? `signed by ${fingerprint(full.mandatePublicKey)}` : "mandate not bundled (unknown mandate id)",
  });

  const matchOk = full.mandate !== null && full.denial.mandateId === full.mandate.id;
  checks.push({
    id: "denial_matches_mandate",
    label: "Denial references the mandate it was checked against",
    ok: matchOk,
  });

  const denialOk = verifyCanonical(full.denialPublicKey, full.denial, full.denialSignature);
  checks.push({
    id: "denial_signature",
    label: "Denial signature (Ed25519) verifies",
    ok: denialOk,
    detail: `signed by ${fingerprint(full.denialPublicKey)}`,
  });

  return { subject: "denial", id: full.denial.denialId, checks, overall: checks.every((c) => c.ok) };
}

function fingerprint(publicKeyB64: string): string {
  return sha256Hex(publicKeyB64).slice(0, 12);
}

function minorString(amount: string, currency: string): string {
  // Enforcer journals amount_minor at capture time; recompute it here from the
  // receipt's decimal string without importing enforcer code.
  const [intPart, fracPart = ""] = amount.split(".");
  const exp = currency.toUpperCase() === "JPY" ? 0 : 2;
  const frac = (fracPart + "0".repeat(exp)).slice(0, exp);
  return `${intPart}${frac}`;
}
