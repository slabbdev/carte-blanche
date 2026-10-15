import type { PayPalClient } from "../paypal/client.js";
import type { Enforcer } from "../enforcer/enforcer.js";
import type { Journal } from "../journal/journal.js";
import type { Receipt, Denial } from "../receipts/receipts.js";

/**
 * A normalized dispute for the merchant cockpit. `source` never lies:
 * sandbox/live rows come from the PayPal Disputes API, "mock" rows are
 * seeded locally to keep the cockpit demoable without credentials.
 */
export interface DisputeView {
  disputeId: string;
  reason: string;
  status: string;
  /** dispute_life_cycle_stage — INQUIRY | CHARGEBACK | PRE_ARBITRATION. */
  stage?: string;
  amount?: string;
  currency?: string;
  openedAt?: string;
  /** Computed respond-by deadline (estimate: 10-day seller window). */
  respondBy?: string;
  source: "paypal" | "mock";
  linkedReceiptId?: string;
  linkedOrderId?: string;
  /** Mock rows only: how many signed refusals exist on the linked mandate. */
  refusalCount?: number;
  disputedTransactions?: Array<{ transaction_id?: string }>;
  raw?: unknown;
}

export interface DisputeDeps {
  railsMode: "mock" | "sandbox" | "live";
  client?: PayPalClient;
  enforcer: Enforcer;
  journal: Journal;
}

const SELLER_WINDOW_DAYS = 10;

export class DisputeService {
  constructor(private readonly deps: DisputeDeps) {}

  get source(): DisputeView["source"] {
    return this.deps.railsMode === "mock" ? "mock" : "paypal";
  }

  async list(): Promise<DisputeView[]> {
    if (this.source === "mock") return this.mockDisputes();
    const client = this.deps.client;
    if (!client) throw new Error("PayPal client unavailable in non-mock mode");
    const res = await client.listDisputes();
    const items = res.data.items ?? [];
    return items.map((it) => this.normalizeReal(it, res.data));
  }

  async get(id: string): Promise<DisputeView | undefined> {
    if (this.source === "mock") return (await this.mockDisputes()).find((d) => d.disputeId === id);
    const client = this.deps.client;
    if (!client) throw new Error("PayPal client unavailable in non-mock mode");
    const res = await client.getDispute(id);
    if (!res.ok) return undefined;
    return this.normalizeReal(res.data as never, res.data);
  }

  /** Sandbox-only testing aid: file a SAMPLE dispute against one of our transactions. */
  async createSample(args: { transactionId: string; reason: string; note?: string }): Promise<{ ok: boolean; detail: string; disputeId?: string }> {
    if (this.source === "mock") {
      return { ok: false, detail: "mock rails: seeding real disputes is a sandbox operation" };
    }
    const client = this.deps.client;
    if (!client) return { ok: false, detail: "PayPal client unavailable" };
    const res = await client.createSampleDispute(args);
    const data = res.data as { dispute_id?: string };
    return res.ok
      ? { ok: true, detail: "SAMPLE dispute created in sandbox", disputeId: data.dispute_id }
      : { ok: false, detail: `PayPal createDispute failed (${res.status}): ${JSON.stringify(res.data).slice(0, 400)}` };
  }

  async submitEvidence(disputeId: string, evidence: Array<Record<string, unknown>>, notes?: string): Promise<{ ok: boolean; detail: string }> {
    if (this.source === "mock") {
      return {
        ok: false,
        detail: "mock rails: submission is a sandbox operation — the pack itself is real and downloadable",
      };
    }
    const client = this.deps.client;
    if (!client) return { ok: false, detail: "PayPal client unavailable" };
    const res = await client.provideEvidence(disputeId, evidence, notes);
    if (res.ok) return { ok: true, detail: `evidence submitted to dispute ${disputeId}` };
    // INQUIRY-stage cases (PP-R) use the send-evidence endpoint instead.
    const fallback = await client.sendEvidence(disputeId, evidence, notes);
    if (fallback.ok) return { ok: true, detail: `evidence submitted (send-evidence, INQUIRY stage) to ${disputeId}` };
    return { ok: false, detail: `PayPal evidence failed: provide-evidence → ${res.status}, send-evidence → ${fallback.status}: ${JSON.stringify(fallback.data ?? {}).slice(0, 300)}` };
  }

  // ------------------------------------------------------------------

  private normalizeReal(item: Record<string, unknown>, raw: unknown): DisputeView {
    const openedAt = typeof item.create_time === "string" ? item.create_time : undefined;
    const txs = Array.isArray(item.disputed_transactions)
      ? (item.disputed_transactions as Array<Record<string, unknown>>).map((t) => ({
          transaction_id: typeof t.seller_transaction_id === "string" ? t.seller_transaction_id : undefined,
        }))
      : undefined;
    const dispute: DisputeView = {
      disputeId: String(item.dispute_id ?? "unknown"),
      reason: String(item.reason ?? "unknown"),
      status: String(item.status ?? "unknown"),
      stage: typeof item.dispute_life_cycle_stage === "string" ? item.dispute_life_cycle_stage : undefined,
      openedAt,
      respondBy: openedAt ? plusDays(openedAt, SELLER_WINDOW_DAYS) : undefined,
      source: "paypal",
      disputedTransactions: txs,
      raw,
    };
    const amountObj = (item.dispute_amount ?? {}) as { value?: string; currency_code?: string };
    if (typeof amountObj.value === "string") {
      dispute.amount = amountObj.value;
      dispute.currency = amountObj.currency_code;
    }
    this.link(dispute);
    return dispute;
  }

  /**
   * Seeds cockpit rows from the receipts already in state. With receipts on
   * file the rows link to them (evidence pack gets real); with none, the row
   * still demonstrates deadlines and the empty-pack state honestly.
   */
  private mockDisputes(): DisputeView[] {
    const receipts = this.deps.enforcer.listReceipts();
    const denials = this.deps.enforcer.listDenials();
    const now = Date.now();
    const rows: DisputeView[] = [];
    const mk = (
      id: string,
      reason: string,
      status: string,
      openedAt: string,
      receipt?: Receipt,
      stage?: string,
    ): DisputeView => {
      const d: DisputeView = {
        disputeId: id,
        reason,
        status,
        ...(stage ? { stage } : {}),
        amount: receipt?.amount ?? "0.00",
        currency: receipt?.currency ?? "USD",
        openedAt,
        respondBy: plusDays(openedAt, SELLER_WINDOW_DAYS),
        source: "mock",
      };
      if (receipt) {
        d.linkedReceiptId = receipt.receiptId;
        d.linkedOrderId = receipt.orderId;
        d.disputedTransactions = [{ transaction_id: receipt.orderId }];
      }
      return d;
    };

    const [r1, r2] = receipts;
    if (r1) rows.push(mk("MOCK-D-001", "ITEM_NOT_RECEIVED", "OPEN", new Date(now - 6 * 86_400_000).toISOString(), r1, "INQUIRY"));
    if (r2) rows.push(mk("MOCK-D-002", "UNAUTHORIZED_TRANSACTION", "UNDER_REVIEW", new Date(now - 2 * 86_400_000).toISOString(), r2, "CHARGEBACK"));
    if (rows.length === 0) {
      rows.push(mk("MOCK-D-000", "ITEM_NOT_RECEIVED", "OPEN", new Date(now - 6 * 86_400_000).toISOString(), undefined, "INQUIRY"));
    }
    // Refusal counts are per-mandate (the pack's §4 must agree with the row).
    for (const d of rows) {
      const linked = receipts.find((r) => r.receiptId === d.linkedReceiptId);
      d.refusalCount = linked ? this.deps.enforcer.listDenials(linked.mandateId).length : denials.length;
    }
    return rows.sort((a, b) => ((a.respondBy ?? "") < (b.respondBy ?? "") ? -1 : 1));
  }

  /** Links a real dispute to a local receipt by transaction id, order id or capture id. */
  private link(dispute: DisputeView): void {
    const ids = new Set<string>();
    for (const t of dispute.disputedTransactions ?? []) if (t.transaction_id) ids.add(t.transaction_id);
    if (ids.size === 0) return;
    for (const r of this.deps.enforcer.listReceipts()) {
      if (ids.has(r.orderId) || ids.has(r.captureId)) {
        dispute.linkedReceiptId = r.receiptId;
        dispute.linkedOrderId = r.orderId;
        return;
      }
    }
  }
}

/** Denials on the same mandate as a receipt — evidence that enforcement was live. */
export function denialsForMandate(enforcer: Enforcer, receipt: Receipt | undefined): Denial[] {
  if (!receipt) return [];
  return enforcer.listDenials(receipt.mandateId).slice(0, 5);
}

function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}
