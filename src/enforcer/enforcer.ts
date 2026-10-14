import { canonicalJson } from "../lib/canonical.js";
import { sha256Hex } from "../lib/sign.js";
import { loadJson, saveJson } from "../lib/persist.js";
import type { Keys } from "../lib/keys.js";
import type { Journal } from "../journal/journal.js";
import type { TsaClient } from "../journal/tsa.js";
import type { MandateStore } from "../mandate/store.js";
import { formatAmount, parseAmount, type SignedMandate } from "../mandate/mandate.js";
import { verifyMandate } from "../mandate/signing.js";
import type { PaymentRails } from "../paypal/adapter.js";
import {
  newDenialId,
  newReceiptId,
  signDenial,
  signReceipt,
  type Denial,
  type FullDenial,
  type FullReceipt,
  type Receipt,
} from "../receipts/receipts.js";

export type DenialReason =
  | "MANDATE_NOT_FOUND"
  | "MANDATE_TAMPERED"
  | "MANDATE_REVOKED"
  | "WINDOW_NOT_OPEN"
  | "WINDOW_EXPIRED"
  | "CURRENCY_MISMATCH"
  | "INVALID_AMOUNT"
  | "OVER_PER_TRANSACTION"
  | "OVER_TOTAL_CAP"
  | "PAYEE_NOT_ALLOWED";

export interface PurchaseRequest {
  mandateId: string;
  amount: string;
  currency: string;
  payee?: string;
  description: string;
  /**
   * "wallet" stops the order at PAYER_ACTION_REQUIRED so a human can approve
   * (the two-phase flow); "card" auto-captures in sandbox. Default: card.
   */
  funding?: "card" | "wallet";
  /**
   * Optional caller-supplied key that makes retries idempotent at the business
   * level: the same logical key always returns the same outcome and triggers at
   * most one PayPal side effect. Defaults to a hash of the request fields.
   */
  logicalKey?: string;
}

export type Outcome =
  | { kind: "receipt"; receipt: Receipt; full: FullReceipt }
  | { kind: "denial"; denial: Denial; full: FullDenial }
  | { kind: "pending"; logicalKey: string; mandateId: string; orderId: string; approvalUrl: string };

interface StoredState {
  receipts: Receipt[];
  denials: Denial[];
}

/**
 * The layer that sits between an AI agent and PayPal. Every mutative call is:
 *   1. checked against the signed mandate (amount, currency, payee, window,
 *      cumulative cap),
 *   2. journalled before and after,
 *   3. executed with a deterministic PayPal-Request-Id so a framework retry
 *      can never double-spend,
 *   4. answered with a signed receipt — or a signed proof of refusal.
 */
export class Enforcer {
  private readonly receipts = new Map<string, Receipt>();
  private readonly denials = new Map<string, Denial>();
  private readonly memo = new Map<string, Outcome>();

  private readonly tsa?: TsaClient;

  constructor(
    private readonly journal: Journal,
    private readonly store: MandateStore,
    private readonly rails: PaymentRails,
    private readonly keys: Keys,
    private readonly stateDir: string,
    options?: { tsa?: TsaClient },
  ) {
    this.tsa = options?.tsa;
    const state = loadJson<StoredState>(
      `${stateDir}/outcomes.json`,
      { receipts: [], denials: [] },
    );
    for (const r of state.receipts) this.receipts.set(r.receiptId, r);
    for (const d of state.denials) this.denials.set(d.denialId, d);
  }

  listReceipts(mandateId?: string): Receipt[] {
    const all = [...this.receipts.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return mandateId ? all.filter((r) => r.mandateId === mandateId) : all;
  }

  listDenials(mandateId?: string): Denial[] {
    const all = [...this.denials.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return mandateId ? all.filter((d) => d.mandateId === mandateId) : all;
  }

  fullReceipt(receiptId: string): FullReceipt | undefined {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) return undefined;
    const signed = this.store.get(receipt.mandateId);
    if (!signed) return undefined;
    return this.assembleReceipt(receipt, signed);
  }

  fullDenial(denialId: string): FullDenial | undefined {
    const denial = this.denials.get(denialId);
    if (!denial) return undefined;
    const signed = this.store.get(denial.mandateId);
    if (!signed) return undefined;
    return this.assembleDenial(denial, signed);
  }

  async purchase(req: PurchaseRequest): Promise<Outcome> {
    const logicalKey = req.logicalKey ?? defaultLogicalKey(req);
    const memoed = this.memo.get(logicalKey);
    if (memoed) return memoed;
    const outcome = await this.process(logicalKey, req);
    this.memo.set(logicalKey, outcome);
    return outcome;
  }

  private async process(logicalKey: string, req: PurchaseRequest): Promise<Outcome> {
    const deny = (reasonCode: DenialReason, reasonDetail: string): Outcome => {
      const denial: Denial = {
        denialId: newDenialId(logicalKey),
        mandateId: req.mandateId,
        logicalKey,
        createdAt: new Date().toISOString(),
        requested: {
          amount: req.amount,
          currency: req.currency,
          payee: req.payee,
          description: req.description,
        },
        reasonCode,
        reasonDetail,
        chainTip: this.journal.tip(),
        journalLength: this.journal.length,
      };
      this.journal.append("purchase_denied", {
        mandate_id: req.mandateId,
        logical_key: logicalKey,
        denial_id: denial.denialId,
        requested: { amount: req.amount, currency: req.currency, payee: req.payee },
        reason_code: reasonCode,
        reason_detail: reasonDetail,
      });
      this.denials.set(denial.denialId, denial);
      this.persist();
      const signed = this.store.get(req.mandateId);
      const full = signed
        ? this.assembleDenial(denial, signed)
        : this.assembleDenialWithoutMandate(denial);
      return { kind: "denial", denial, full };
    };

    const signed = this.store.get(req.mandateId);
    if (!signed) return deny("MANDATE_NOT_FOUND", `no mandate with id ${req.mandateId}`);
    if (!verifyMandate(signed)) {
      return deny("MANDATE_TAMPERED", "stored mandate no longer matches its signature");
    }
    if (this.store.isRevoked(req.mandateId)) {
      const rec = this.store.revocationOf(req.mandateId);
      return deny("MANDATE_REVOKED", `revoked at ${rec?.revokedAt} (${rec?.reason})`);
    }

    const mandate = signed.mandate;
    const now = Date.now();
    const start = Date.parse(mandate.limits.windowStart);
    const end = Date.parse(mandate.limits.windowEnd);
    if (now < start) return deny("WINDOW_NOT_OPEN", `window opens at ${mandate.limits.windowStart}`);
    if (now > end) return deny("WINDOW_EXPIRED", `window closed at ${mandate.limits.windowEnd}`);
    if (req.currency !== mandate.limits.currency) {
      return deny("CURRENCY_MISMATCH", `mandate is denominated in ${mandate.limits.currency}`);
    }

    let amountMinor: bigint;
    try {
      amountMinor = parseAmount(req.amount, req.currency);
    } catch (e) {
      return deny("INVALID_AMOUNT", (e as Error).message);
    }

    const perTx = parseAmount(mandate.limits.maxPerTransaction, mandate.limits.currency);
    if (amountMinor > perTx) {
      return deny(
        "OVER_PER_TRANSACTION",
        `requested ${req.amount} exceeds per-transaction cap ${mandate.limits.maxPerTransaction}`,
      );
    }

    const payees = mandate.limits.payees;
    if (payees && req.payee && !payees.includes(req.payee)) {
      return deny("PAYEE_NOT_ALLOWED", `${req.payee} is not on the mandate allowlist`);
    }

    const spent = this.journal.capturedMinorFor(req.mandateId);
    const cap = parseAmount(mandate.limits.maxTotalSpend, mandate.limits.currency);
    if (spent + amountMinor > cap) {
      const remaining = cap > spent ? formatAmount(cap - spent, mandate.limits.currency) : "0.00";
      return deny(
        "OVER_TOTAL_CAP",
        `cumulative cap ${mandate.limits.maxTotalSpend} would be exceeded (already spent ${formatAmount(spent, mandate.limits.currency)}, remaining ${remaining})`,
      );
    }

    // --- authorized: journal intent, then execute with deterministic ids ---
    this.journal.append("purchase_requested", {
      mandate_id: req.mandateId,
      logical_key: logicalKey,
      amount: req.amount,
      amount_minor: amountMinor.toString(),
      currency: req.currency,
      payee: req.payee,
      description: req.description,
    });

    const createRequestId = `cb-${logicalKey}-cr`;
    const captureRequestId = `cb-${logicalKey}-cp`;
    // Agent-purchase marker, stamped onto PayPal's OWN order record (custom_id):
    // PayPal cannot tell an agent purchase from a human one — this label makes
    // every agent purchase self-declaring and detectable on their side (order
    // reads, transaction search, webhooks) without PayPal changing anything.
    const agentMarker = `cb|agent=${signed.mandate.agent}|mandate=${signed.mandate.id}`;
    const order = await this.rails.createOrder({
      amount: req.amount,
      currency: req.currency,
      description: req.description,
      payee: req.payee,
      requestId: createRequestId,
      customId: agentMarker,
      ...(req.funding ? { funding: req.funding } : {}),
    });
    this.journal.append("order_created", {
      mandate_id: req.mandateId,
      logical_key: logicalKey,
      order_id: order.id,
      rails_mode: this.rails.mode,
      paypal_request_id: createRequestId,
    });

    const capture = await this.rails.captureOrder(order.id, captureRequestId);
    // Wallet orders stop here on purpose: the buyer (a human) must approve
    // before money moves. Journal the pending position and hand back the
    // approval redirect; resumePurchase() finishes after the human agrees.
    if (capture.status === "PAYER_ACTION_REQUIRED") {
      this.journal.append("order_awaiting_buyer", {
        mandate_id: req.mandateId,
        logical_key: logicalKey,
        order_id: capture.orderId,
        status: capture.status,
        amount: req.amount,
        amount_minor: amountMinor.toString(),
        currency: req.currency,
        rails_mode: this.rails.mode,
        paypal_request_id: captureRequestId,
      });
      const outcome: Outcome = {
        kind: "pending",
        logicalKey,
        mandateId: req.mandateId,
        orderId: capture.orderId,
        approvalUrl: capture.approvalUrl ?? "",
      };
      return outcome;
    }
    const event = this.journal.append("order_captured", {
      mandate_id: req.mandateId,
      logical_key: logicalKey,
      order_id: capture.orderId,
      capture_id: capture.captureId,
      status: capture.status,
      amount: req.amount,
      amount_minor: amountMinor.toString(),
      currency: req.currency,
      rails_mode: this.rails.mode,
      paypal_request_id: captureRequestId,
    });

    const receipt: Receipt = {
      receiptId: newReceiptId(logicalKey),
      mandateId: req.mandateId,
      logicalKey,
      createdAt: event.ts,
      amount: req.amount,
      currency: req.currency,
      description: req.description,
      payee: req.payee,
      orderId: capture.orderId,
      captureId: capture.captureId,
      status: capture.status,
      chainTip: this.journal.tip(),
      journalLength: this.journal.length,
    };
    this.receipts.set(receipt.receiptId, receipt);
    this.persist();

    // Best-effort anchor: a slow or unreachable TSA must never block a
    // purchase — the receipt simply ships without the tsa_anchor check.
    if (this.tsa) {
      try {
        await this.journal.anchorTreeHead(this.tsa);
      } catch {
        /* anchoring is additive evidence, never a gate */
      }
    }

    const full = this.assembleReceipt(receipt, signed);
    return { kind: "receipt", receipt, full };
  }

  /**
   * Human-in-the-loop wallet flow, step two: the buyer approved at the
   * redirect and the watcher calls back. The capture replays with the SAME
   * deterministic PayPal-Request-Id (the order exists; PayPal idempotency
   * makes the replay safe), the capture is journalled and the receipt
   * commits to the whole story: mandate → intent → order → human approval →
   * capture → TSA anchor.
   */
  async resumePurchase(logicalKey: string): Promise<Outcome> {
    const done = this.memo.get(logicalKey);
    if (done?.kind === "receipt") return done;
    const events = this.journal.eventsFor((d) => d.logical_key === logicalKey);
    const created = events.find((e) => e.type === "order_created");
    const awaiting = [...events].reverse().find((e) => e.type === "order_awaiting_buyer");
    if (!created || !awaiting) throw new Error(`no pending wallet purchase for logical key ${logicalKey}`);
    const createdData = created.data as Record<string, unknown>;
    const awaitingData = awaiting.data as Record<string, unknown>;
    const mandateId = String(createdData.mandate_id);
    const signed = this.store.get(mandateId);
    if (!signed) throw new Error(`mandate ${mandateId} not found while resuming ${logicalKey}`);
    const requested = events.find((e) => e.type === "purchase_requested")?.data as Record<string, unknown> | undefined;
    const captureRequestId = `cb-${logicalKey}-cp`;
    const capture = await this.rails.captureOrder(String(awaitingData.order_id), captureRequestId);
    if (capture.status === "PAYER_ACTION_REQUIRED") {
      throw new Error("buyer has not approved yet — approve at the redirect and retry");
    }
    const event = this.journal.append("order_captured", {
      mandate_id: mandateId,
      logical_key: logicalKey,
      order_id: capture.orderId,
      capture_id: capture.captureId,
      status: capture.status,
      amount: String(awaitingData.amount),
      amount_minor: String(awaitingData.amount_minor),
      currency: String(awaitingData.currency),
      rails_mode: this.rails.mode,
      paypal_request_id: captureRequestId,
    });
    const receipt: Receipt = {
      receiptId: newReceiptId(logicalKey),
      mandateId,
      logicalKey,
      createdAt: event.ts,
      amount: String(awaitingData.amount),
      currency: String(awaitingData.currency),
      description: String(requested?.description ?? ""),
      ...(requested?.payee ? { payee: String(requested.payee) } : {}),
      orderId: capture.orderId,
      captureId: capture.captureId,
      status: capture.status,
      chainTip: this.journal.tip(),
      journalLength: this.journal.length,
    };
    this.receipts.set(receipt.receiptId, receipt);
    this.persist();

    if (this.tsa) {
      try {
        await this.journal.anchorTreeHead(this.tsa);
      } catch {
        /* anchoring is additive evidence, never a gate */
      }
    }

    const full = this.assembleReceipt(receipt, signed);
    const outcome: Outcome = { kind: "receipt", receipt, full };
    this.memo.set(logicalKey, outcome);
    return outcome;
  }

  private assembleReceipt(receipt: Receipt, signed: SignedMandate): FullReceipt {
    const events = this.journal.eventsFor(
      (d) => d.logical_key === receipt.logicalKey && d.mandate_id === receipt.mandateId,
    );
    const captured = events.find((e) => e.type === "order_captured");
    let inclusion: FullReceipt["inclusion"];
    if (captured) {
      const treeHead = this.journal.signedTreeHead();
      const anchor = this.journal.anchorForSize(treeHead.size);
      inclusion = {
        seq: captured.seq,
        proof: this.journal.inclusionProofForSeq(captured.seq),
        treeHead,
        ...(anchor ? { anchor } : {}),
      };
    }
    return {
      receipt: { ...receipt },
      mandate: signed.mandate,
      mandateSignature: signed.signature,
      mandatePublicKey: signed.publicKey,
      events,
      receiptSignature: signReceipt(receipt, this.keys.server.privateKeyB64),
      receiptPublicKey: this.keys.server.publicKeyB64,
      railsMode: this.rails.mode,
      ...(inclusion ? { inclusion } : {}),
    };
  }

  private assembleDenial(denial: Denial, signed: SignedMandate): FullDenial {
    return {
      denial: { ...denial },
      mandate: signed.mandate,
      mandateSignature: signed.signature,
      mandatePublicKey: signed.publicKey,
      denialSignature: signDenial(denial, this.keys.server.privateKeyB64),
      denialPublicKey: this.keys.server.publicKeyB64,
      railsMode: this.rails.mode,
    };
  }

  /** Refusals for an unknown mandate still get a signed proof, minus the mandate bundle. */
  private assembleDenialWithoutMandate(denial: Denial): FullDenial {
    return {
      denial: { ...denial },
      mandate: null,
      mandateSignature: null,
      mandatePublicKey: null,
      denialSignature: signDenial(denial, this.keys.server.privateKeyB64),
      denialPublicKey: this.keys.server.publicKeyB64,
      railsMode: this.rails.mode,
    };
  }

  private persist(): void {
    saveJson(
      `${this.stateDir}/outcomes.json`,
      { receipts: [...this.receipts.values()], denials: [...this.denials.values()] },
    );
  }
}

function defaultLogicalKey(req: PurchaseRequest): string {
  return sha256Hex(
    canonicalJson({
      mandateId: req.mandateId,
      amount: req.amount,
      currency: req.currency,
      payee: req.payee,
      description: req.description,
    }),
  ).slice(0, 32);
}
