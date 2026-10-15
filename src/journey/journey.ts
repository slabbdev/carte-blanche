import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { loadJson, saveJson } from "../lib/persist.js";
import { parseAmount, formatAmount } from "../mandate/mandate.js";
import type { Journal } from "../journal/journal.js";
import type { Enforcer } from "../enforcer/enforcer.js";

/**
 * Purchase journeys: a planned, human-approvable spending plan. Lines come
 * from the Channel3 shopping scene; approving a journey derives and signs a
 * mandate from it (the Amex challenge, applied to a basket instead of a
 * single item); running it executes every line through the enforcer, so the
 * grid fills with the same signed receipts and refusals as any other path.
 */

export interface JourneyItem {
  id: string;
  title: string;
  /** Payee / merchant domain — what the mandate allowlist will pin. */
  merchant?: string;
  /** Unit price, decimal string. */
  price: string;
  currency: string;
  quantity: number;
  status: "planned" | "receipt" | "refused";
  /** receiptId or denialId once attempted. */
  outcomeId?: string;
  detail?: string;
}

export interface Journey {
  id: string;
  name: string;
  currency: string;
  items: JourneyItem[];
  createdAt: string;
  approvedAt?: string;
  /** Set once the journey has been turned into a signed mandate. */
  mandateId?: string;
  /** Set at approval when the buyer chose a recurring cadence for this basket. */
  recurrence?: { frequency: "monthly" | "weekly" };
  /** Cycle keys run so far (e.g. "2026-11"); per-cycle outcomes live in the journal. */
  cyclesRun?: string[];
}

export interface JourneyLineInput {
  title: string;
  merchant?: string;
  price: string;
  quantity?: number;
}

export function journeyTotal(j: Journey): string {
  let total = 0n;
  for (const item of j.items) {
    total += parseAmount(item.price, j.currency) * BigInt(Math.max(1, item.quantity));
  }
  return formatAmount(total, j.currency);
}

export function lineTotal(item: JourneyItem): string {
  return formatAmount(
    parseAmount(item.price, item.currency) * BigInt(Math.max(1, item.quantity)),
    item.currency,
  );
}

/** The mandate limits a journey derives: per-line max, basket total, allowlist. */
export function mandateLimitsFrom(j: Journey): {
  maxPerTransaction: string;
  maxTotalSpend: string;
  payees: string[];
} {
  const lineTotals = j.items.map((i) => parseAmount(i.price, j.currency) * BigInt(Math.max(1, i.quantity)));
  const max = lineTotals.reduce((a, b) => (a > b ? a : b), 0n);
  const payees = [...new Set(j.items.map((i) => i.merchant).filter((m): m is string => Boolean(m)))];
  return {
    maxPerTransaction: formatAmount(max, j.currency),
    maxTotalSpend: journeyTotal(j),
    payees,
  };
}

/**
 * Run every still-planned line through the enforcer. Returns the journey with
 * per-line outcomes; the enforcer journals (and signs) each attempt itself.
 * `logicalKey` is derived from the journey + line ids so a re-run replays the
 * same logical purchase instead of spending twice.
 *
 * `opts.cycle` re-runs the SAME approved basket in a new period ("2026-11")
 * under a recurring mandate: cycle-scoped logical keys let the same lines
 * purchase again next month, while previous cycles' outcomes stay sealed in
 * the journal. Items reflect the latest cycle only — the chain holds history.
 */
export async function executeJourney(
  j: Journey,
  journal: Journal,
  enforcer: Enforcer,
  opts?: { cycle?: string },
): Promise<Journey> {
  if (!j.mandateId) throw new Error("journey is not approved yet — no mandate to spend under");
  const cycle = opts?.cycle?.trim();
  if (cycle) {
    if (!/^\d{4}-\d{2}$/.test(cycle)) throw new Error(`invalid cycle key ${JSON.stringify(cycle)} — expected "YYYY-MM"`);
    if (!(j.cyclesRun ?? []).includes(cycle)) {
      j.cyclesRun = [...(j.cyclesRun ?? []), cycle];
      journal.append("journey_cycle_started", { journey_id: j.id, cycle, mandate_id: j.mandateId });
    }
    // a fresh period re-attempts every line; per-line status is the latest cycle's view
    for (const item of j.items) {
      item.status = "planned";
      delete item.outcomeId;
      delete item.detail;
    }
  }
  for (const item of j.items) {
    if (item.status !== "planned") continue;
    const amount = lineTotal(item);
    const outcome = await enforcer.purchase({
      mandateId: j.mandateId,
      amount,
      currency: j.currency,
      ...(item.merchant ? { payee: item.merchant } : {}),
      description: `[journey ${j.name}] ${item.title}`,
      logicalKey: cycle ? `jrn-${j.id}-${cycle}-${item.id}` : `jrn-${j.id}-${item.id}`,
    });
    journal.append("journey_line_attempted", {
      journey_id: j.id,
      ...(cycle ? { cycle } : {}),
      line_id: item.id,
      title: item.title,
      merchant: item.merchant,
      amount,
      outcome: outcome.kind,
      artifact_id: outcome.kind === "receipt" ? outcome.receipt.receiptId : outcome.kind === "denial" ? outcome.denial.denialId : "",
    });
    if (outcome.kind === "receipt") {
      item.status = "receipt";
      item.outcomeId = outcome.receipt.receiptId;
      item.detail = `order ${outcome.receipt.orderId}`;
    } else if (outcome.kind === "denial") {
      item.status = "refused";
      item.outcomeId = outcome.denial.denialId;
      item.detail = `${outcome.denial.reasonCode}: ${outcome.denial.reasonDetail}`;
    } else {
      // pending (wallet approval) — leave planned; the receipt lands on resume
      item.detail = "awaiting buyer approval";
    }
  }
  return j;
}

interface StoredJourneys {
  journeys: Journey[];
}

export class JourneyPlanner {
  private readonly journeys = new Map<string, Journey>();

  constructor(
    private readonly stateDir: string,
    private readonly journal: Journal,
  ) {
    const stored = loadJson<StoredJourneys>(`${stateDir}/journeys.json`, { journeys: [] });
    for (const j of stored.journeys) this.journeys.set(j.id, j);
  }

  list(): Journey[] {
    return [...this.journeys.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  get(id: string): Journey | undefined {
    return this.journeys.get(id);
  }

  plan(name: string, currency: string, lines: JourneyLineInput[]): Journey {
    const journey: Journey = {
      id: `jrn-${randomUUID().slice(0, 8)}`,
      name: name.slice(0, 80) || "shopping journey",
      currency: currency.toUpperCase(),
      createdAt: new Date().toISOString(),
      items: lines.map((l) => ({
        id: randomUUID().slice(0, 8),
        title: String(l.title).slice(0, 140),
        ...(l.merchant ? { merchant: String(l.merchant).slice(0, 120) } : {}),
        price: l.price,
        currency: currency.toUpperCase(),
        quantity: Math.max(1, Math.min(99, Math.round(Number(l.quantity) || 1))),
        status: "planned" as const,
      })),
    };
    this.journeys.set(journey.id, journey);
    this.persist();
    this.journal.append("journey_planned", {
      journey_id: journey.id,
      name: journey.name,
      lines: journey.items.length,
      total: journeyTotal(journey),
      currency: journey.currency,
    });
    return journey;
  }

  addLine(id: string, line: JourneyLineInput): Journey | undefined {
    const j = this.journeys.get(id);
    if (!j) return undefined;
    const item: JourneyItem = {
      id: randomUUID().slice(0, 8),
      title: String(line.title).slice(0, 140),
      ...(line.merchant ? { merchant: String(line.merchant).slice(0, 120) } : {}),
      price: line.price,
      currency: j.currency,
      quantity: Math.max(1, Math.min(99, Math.round(Number(line.quantity) || 1))),
      status: "planned",
    };
    j.items.push(item);
    this.persist();
    this.journal.append("journey_line_added", {
      journey_id: j.id,
      line_id: item.id,
      title: item.title,
      merchant: item.merchant,
      price: item.price,
      total_after: journeyTotal(j),
    });
    return j;
  }

  removeLine(id: string, lineId: string): Journey | undefined {
    const j = this.journeys.get(id);
    if (!j) return undefined;
    j.items = j.items.filter((i) => i.id !== lineId);
    this.persist();
    return j;
  }

  remove(id: string): boolean {
    const gone = this.journeys.delete(id);
    if (gone) this.persist();
    return gone;
  }

  /** Marks the journey as human-approved under the given signed mandate. */
  markApproved(
    id: string,
    mandateId: string,
    recurrence?: { frequency: "monthly" | "weekly" },
  ): Journey | undefined {
    const j = this.journeys.get(id);
    if (!j) return undefined;
    j.mandateId = mandateId;
    j.approvedAt = new Date().toISOString();
    if (recurrence) j.recurrence = recurrence;
    this.persist();
    this.journal.append("journey_approved", {
      journey_id: j.id,
      mandate_id: mandateId,
      total: journeyTotal(j),
      lines: j.items.length,
      ...(recurrence ? { recurrence: recurrence.frequency } : {}),
    });
    return j;
  }

  /** Persists in-place mutations done outside planner methods (journey runs). */
  persistNow(): void {
    this.persist();
  }

  private persist(): void {
    saveJson(`${this.stateDir}/journeys.json`, { journeys: this.list() });
  }
}
