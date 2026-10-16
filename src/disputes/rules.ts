/**
 * Dispute automation rules — the Carte Blanche answer to PayPal's dispute
 * automation, with the piece PayPal's rules lack: coverage awareness. A rule
 * can require that the evidence pack actually covers the dispute (mandate
 * present, fulfillment filled…) before auto-settling, so automation never
 * settles a case the evidence cannot win — and never fights one it can.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { DisputeView } from "./service.js";
import type { CoverageFacts } from "./coverage.js";
import { recommendDefense } from "./coverage.js";

export interface DisputeRule {
  id: string;
  name: string;
  priority: number;
  /** Empty = any reason. Codes as spelled by the API (ITEM_NOT_RECEIVED, UNAUTHORISED…). */
  reasons: string[];
  /** Settles only disputes up to this amount (in the dispute's currency). */
  maxAmount?: number;
  /** Require a linked signed mandate before automating. */
  requireMandate: boolean;
  action: "auto_refund" | "auto_reject";
  active: boolean;
  createdAt: string;
}

export interface RuleMatch {
  rule: DisputeRule;
  reason: string;
}

export class DisputeRuleStore {
  private rules = new Map<string, DisputeRule>();

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { rules: DisputeRule[] };
      for (const r of raw.rules ?? []) this.rules.set(r.id, r);
    } catch {
      /* fresh start */
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify({ rules: [...this.rules.values()] }, null, 2));
  }

  list(): DisputeRule[] {
    return [...this.rules.values()].sort((a, b) => b.priority - a.priority);
  }

  create(input: { name: string; reasons?: string[]; maxAmount?: number; requireMandate?: boolean; action: "auto_refund" | "auto_reject"; priority?: number }): DisputeRule {
    const rule: DisputeRule = {
      id: `rule-${randomUUID().slice(0, 8)}`,
      name: String(input.name ?? "rule").slice(0, 60),
      priority: Math.max(1, Math.min(9999, Math.round(Number(input.priority ?? 100)))),
      reasons: (input.reasons ?? []).map((r) => String(r).toUpperCase()),
      ...(input.maxAmount !== undefined ? { maxAmount: Number(input.maxAmount) } : {}),
      requireMandate: Boolean(input.requireMandate),
      action: input.action === "auto_reject" ? "auto_reject" : "auto_refund",
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.rules.set(rule.id, rule);
    this.persist();
    return rule;
  }

  remove(id: string): boolean {
    const gone = this.rules.delete(id);
    if (gone) this.persist();
    return gone;
  }

  setActive(id: string, active: boolean): DisputeRule | undefined {
    const r = this.rules.get(id);
    if (!r) return undefined;
    r.active = active;
    this.persist();
    return r;
  }

  /** Highest-priority active rule whose conditions match this dispute. */
  match(
    dispute: Pick<DisputeView, "reason" | "amount" | "currency">,
    facts: CoverageFacts,
  ): RuleMatch | undefined {
    for (const rule of this.list().filter((r) => r.active)) {
      if (rule.reasons.length && !rule.reasons.includes(String(dispute.reason ?? "").toUpperCase())) continue;
      if (rule.maxAmount !== undefined && Number(dispute.amount ?? Infinity) > rule.maxAmount) continue;
      if (rule.requireMandate && !facts.hasLinkedReceipt) continue;
      // coverage guard: an auto_refund rule must not fire when the pack would WIN,
      // and an auto_reject rule must not fire when settling is the honest path
      const rec = recommendDefense(dispute.reason, facts);
      if (rule.action === "auto_refund" && rec.action === "FIGHT") continue;
      if (rule.action === "auto_reject" && rec.action === "REFUND_FIRST") continue;
      return { rule, reason: `matched rule "${rule.name}" (${rec.action.toLowerCase()} per coverage)` };
    }
    return undefined;
  }
}
