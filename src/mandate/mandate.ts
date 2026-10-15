import { randomUUID } from "node:crypto";

export const MANDATE_VERSION = "cb-mandate/v1" as const;

/**
 * Recurring spending authority: "up to $X per month at the grocer". The
 * mandate's window stays the whole authorization horizon (e.g. one year);
 * the recurrence slices it into weekly/monthly windows, each with its own
 * cumulative cap on top of the mandate-wide maxTotalSpend.
 */
export interface MandateRecurrence {
  frequency: "weekly" | "monthly";
  /** Decimal string. Hard cap on cumulative captured spend INSIDE one window. */
  maxPerWindow: string;
}

export interface MandateLimits {
  /** ISO 4217 currency code the mandate is denominated in. */
  currency: string;
  /** Decimal string, e.g. "25.00". Hard cap per single purchase. */
  maxPerTransaction: string;
  /** Decimal string. Hard cap on cumulative captured spend. */
  maxTotalSpend: string;
  /** When present, purchases are only allowed to these payees (email or merchant id). */
  payees?: string[];
  /** When present, the authorization horizon is sliced into repeating budgets. */
  recurrence?: MandateRecurrence;
  /** ISO 8601 instants, inclusive bounds. */
  windowStart: string;
  windowEnd: string;
}

export interface Mandate {
  id: string;
  version: typeof MANDATE_VERSION;
  /** Who grants the spending authority (the human). */
  principal: string;
  /** Who may act under it (the AI agent). */
  agent: string;
  /** Human-readable scope, e.g. "groceries this week". */
  purpose: string;
  limits: MandateLimits;
  issuedAt: string;
}

export interface SignedMandate {
  mandate: Mandate;
  /** Ed25519 signature over canonicalJson(mandate). */
  signature: string;
  /** Base64 SPKI key of the signer (the principal, or the custodial server today). */
  publicKey: string;
}

export interface RevocationRecord {
  mandateId: string;
  revokedAt: string;
  reason: string;
}

export function newMandateId(): string {
  return `cbmd-${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Money helpers. Amounts are decimal strings; comparison happens in minor
// units (bigint) so there is never a float in the authorization path.
// ---------------------------------------------------------------------------

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "CLP", "VND", "ISK"]);

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

/** Parse a decimal-string amount into minor units. Throws on malformed input. */
export function parseAmount(amount: string, currency: string): bigint {
  if (typeof amount !== "string" || !/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`invalid amount format: ${JSON.stringify(amount)}`);
  }
  const exp = currencyExponent(currency);
  const [intPart, fracPart = ""] = amount.split(".");
  if (fracPart.length > exp) {
    throw new Error(`too many decimal places for ${currency}: ${amount}`);
  }
  const frac = (fracPart + "0".repeat(exp)).slice(0, exp);
  return BigInt(`${intPart}${exp > 0 ? frac : ""}`);
}

export function formatAmount(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return minor.toString();
  const s = minor.toString().padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

export function validateMandate(m: Mandate): string[] {
  const errors: string[] = [];
  if (m.version !== MANDATE_VERSION) errors.push(`unsupported mandate version: ${m.version}`);
  if (!m.principal) errors.push("principal is required");
  if (!m.agent) errors.push("agent is required");
  const start = Date.parse(m.limits.windowStart);
  const end = Date.parse(m.limits.windowEnd);
  if (Number.isNaN(start)) errors.push("limits.windowStart is not a valid ISO 8601 instant");
  if (Number.isNaN(end)) errors.push("limits.windowEnd is not a valid ISO 8601 instant");
  if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
    errors.push("limits.windowEnd is before limits.windowStart");
  }
  try {
    parseAmount(m.limits.maxPerTransaction, m.limits.currency);
  } catch (e) {
    errors.push(`limits.maxPerTransaction: ${(e as Error).message}`);
  }
  try {
    parseAmount(m.limits.maxTotalSpend, m.limits.currency);
  } catch (e) {
    errors.push(`limits.maxTotalSpend: ${(e as Error).message}`);
  }
  if (m.limits.payees !== undefined && !Array.isArray(m.limits.payees)) {
    errors.push("limits.payees must be an array when present");
  }
  if (m.limits.recurrence !== undefined) {
    const r = m.limits.recurrence;
    if (!r || (r.frequency !== "weekly" && r.frequency !== "monthly")) {
      errors.push('limits.recurrence.frequency must be "weekly" or "monthly"');
    }
    try {
      parseAmount(r.maxPerWindow, m.limits.currency);
    } catch (e) {
      errors.push(`limits.recurrence.maxPerWindow: ${(e as Error).message}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Recurrence windows. Windows are [start + n periods, start + (n+1) periods)
// anchored on the mandate's windowStart; monthly addition is calendar-aware
// (Jan 31 + 1 month = Feb 28, not Mar 3), so the "1st of the month" stays the
// "1st of the month" for the life of the mandate.
// ---------------------------------------------------------------------------

export interface RecurrenceWindow {
  /** Zero-based window index within the mandate. */
  index: number;
  /** Inclusive start, ms epoch. */
  startMs: number;
  /** Exclusive end, ms epoch — clamped by the mandate's windowEnd. */
  endMs: number;
}

/** `start + n` periods, calendar-aware for months (day-of-month clamped). */
export function addPeriodsMs(startMs: number, frequency: "weekly" | "monthly", n: number): number {
  if (frequency === "weekly") return startMs + n * 7 * 24 * 3_600_000;
  const d = new Date(startMs);
  const day = d.getUTCDate();
  d.setUTCDate(1); // set month first: raw day could overflow into the next month
  d.setUTCMonth(d.getUTCMonth() + n);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d.getTime();
}

/** The recurrence window containing `atMs`, or undefined when no recurrence / past the horizon. */
export function recurrenceWindow(limits: MandateLimits, atMs: number): RecurrenceWindow | undefined {
  const rec = limits.recurrence;
  if (!rec) return undefined;
  const start0 = Date.parse(limits.windowStart);
  const horizon = Date.parse(limits.windowEnd);
  if (Number.isNaN(start0) || Number.isNaN(horizon)) return undefined;
  let index = 0;
  let ws = start0;
  let we = addPeriodsMs(start0, rec.frequency, 1);
  // Stepping (not arithmetic) keeps calendar months honest: with clamping,
  // window boundaries are only recoverable by walking from the anchor.
  while (atMs >= we && ws < horizon && index < 5200) {
    index += 1;
    ws = we;
    we = addPeriodsMs(start0, rec.frequency, index + 1);
  }
  if (ws >= horizon) return undefined;
  return { index, startMs: ws, endMs: Math.min(we, horizon) };
}
