import { sha256Hex } from "../lib/sign.js";
import type { Keys } from "../lib/keys.js";
import type { Enforcer } from "../enforcer/enforcer.js";
import type { Journal, ChainVerification } from "../journal/journal.js";
import type { MandateStore } from "../mandate/store.js";
import type { FullReceipt, Receipt } from "../receipts/receipts.js";
import { newReceiptId, signReceipt } from "../receipts/receipts.js";
import { denialsForMandate, type DisputeView } from "./service.js";
import { coverageFor, recommendDefense, type Coverage, type DefenseRecommendation } from "./coverage.js";

/**
 * The evidence pack: the artifact this whole project exists for. When a
 * dispute lands on an agent-initiated purchase, the merchant submits a
 * bundle that proves — cryptographically, to any third party —
 *   1. the purchase happened under a signed, immutable spending mandate,
 *   2. every step is journalled in a tamper-evident chain (verified at
 *      generation time),
 *   3. enforcement was live (signed refusals on the same mandate).
 * Classic dispute evidence (proof of fulfillment: tracking, comms) is a
 * pending milestone and is labeled as such — the pack never pretends.
 */
export interface EvidencePack {
  packId: string;
  generatedAt: string;
  generator: string;
  dispute: {
    disputeId: string;
    reason: string;
    status: string;
    openedAt?: string;
    respondBy?: string;
    source: string;
    requestedAmount?: string;
    requestedCurrency?: string;
  };
  linkedPurchase?: {
    receipt: Receipt;
    mandateId: string;
    mandateSignature: string;
    mandatePublicKey: string;
    eventSeqs: number[];
  };
  chain: ChainVerification;
  enforcement: {
    signedRefusals: Array<{ denialId: string; reasonCode: string; createdAt: string }>;
  };
  /** Which of PayPal's required evidence slots this pack fills — and what's missing. */
  coverage: Coverage;
  /** The fight-vs-refund call, answered by coverage. */
  recommendation: DefenseRecommendation;
  fulfillment?: { carrier: string; trackingNumber: string; shippedAt: string; seq: number };
  refund?: { refundId: string; captureId: string; seq: number };
  pending: string[];
}

/** Sanitized pack id — dispute ids can contain characters unfit for filenames. */
function packFileId(disputeId: string): string {
  return `pack-${disputeId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").slice(0, 48)}`;
}

/**
 * Journal fallback linkage: a wallet-funded purchase never became an Enforcer
 * Receipt, but its capture is in the sealed journal. Match the dispute's
 * transaction ids against order_captured events and reconstruct the receipt
 * from journalled facts (mandate signed, chain intact — nothing invented).
 */
function journalLinkedPurchase(
  dispute: DisputeView,
  deps: { enforcer: Enforcer; journal: Journal; store: MandateStore; keys: Keys },
): FullReceipt | undefined {
  const ids = (dispute.disputedTransactions ?? [])
    .map((t) => t.transaction_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return undefined;
  for (const event of deps.journal.eventsOfType("order_captured")) {
    const d = event.data as Record<string, unknown>;
    const orderId = typeof d.order_id === "string" ? d.order_id : "";
    const captureId = typeof d.capture_id === "string" ? d.capture_id : "";
    if (!ids.includes(captureId) && !ids.includes(orderId)) continue;
    const signed = deps.store.get(String(d.mandate_id ?? ""));
    if (!signed) continue;
    const logicalKey = String(d.logical_key ?? "");
    const amount = typeof d.amount === "string" ? d.amount : dispute.amount ?? "0.00";
    const currency = typeof d.currency === "string" ? d.currency : dispute.currency ?? "USD";
    const receipt: Receipt = {
      receiptId: newReceiptId(logicalKey || event.hash),
      mandateId: signed.mandate.id,
      logicalKey,
      createdAt: event.ts,
      amount,
      currency,
      description: typeof d.description === "string" ? d.description : "(journalled purchase)",
      orderId,
      captureId,
      status: String(d.status ?? "COMPLETED"),
      chainTip: deps.journal.tip(),
      journalLength: deps.journal.length,
    };
    const events = deps.journal.eventsFor(
      (x) => x.type !== "purchase_denied" && (x.data as Record<string, unknown>).logical_key === logicalKey,
    );
    return {
      receipt,
      mandate: signed.mandate,
      mandateSignature: signed.signature,
      mandatePublicKey: signed.publicKey,
      events,
      receiptSignature: signReceipt(receipt, deps.keys.server.privateKeyB64),
      receiptPublicKey: deps.keys.server.publicKeyB64,
      railsMode: "sandbox",
      inclusion: {
        seq: event.seq,
        proof: deps.journal.inclusionProofForSeq(event.seq),
        treeHead: deps.journal.signedTreeHead(),
        ...(deps.journal.anchorForSize(deps.journal.signedTreeHead().size)
          ? { anchor: deps.journal.anchorForSize(deps.journal.signedTreeHead().size) }
          : {}),
      },
    };
  }
  return undefined;
}

/**
 * Journalled fulfillment record for an order (latest wins) — the raw material
 * PayPal's PROOF_OF_FULFILLMENT slot wants: carrier + tracking number.
 */
export function fulfillmentFor(
  journal: Journal,
  orderId: string | undefined,
): EvidencePack["fulfillment"] {
  if (!orderId) return undefined;
  let found: EvidencePack["fulfillment"];
  for (const event of journal.eventsOfType("order_fulfilled", (d) => d.order_id === orderId)) {
    const d = event.data as Record<string, unknown>;
    found = {
      carrier: String(d.carrier ?? ""),
      trackingNumber: String(d.tracking_number ?? ""),
      shippedAt: typeof d.shipped_at === "string" ? d.shipped_at : event.ts,
      seq: event.seq,
    };
  }
  return found;
}

/** Journalled fast-lane refund for a capture (latest wins). */
function refundFor(journal: Journal, captureId: string | undefined): EvidencePack["refund"] {
  if (!captureId) return undefined;
  let found: EvidencePack["refund"];
  for (const event of journal.eventsOfType("dispute_fastlane_refund", (d) => d.capture_id === captureId)) {
    const d = event.data as Record<string, unknown>;
    found = {
      refundId: String(d.refund_id ?? ""),
      captureId,
      seq: event.seq,
    };
  }
  return found;
}

export function buildEvidencePack(
  dispute: DisputeView,
  deps: { enforcer: Enforcer; journal: Journal; store: MandateStore; keys: Keys },
): EvidencePack {
  const { enforcer, journal, store } = deps;
  let receipt = dispute.linkedReceiptId ? enforcer.listReceipts().find((r) => r.receiptId === dispute.linkedReceiptId) : undefined;
  let full = receipt ? enforcer.fullReceipt(receipt.receiptId) : undefined;
  if (!full) {
    const linked = journalLinkedPurchase(dispute, deps);
    if (linked) {
      full = linked;
      receipt = linked.receipt;
    }
  }
  const denials = denialsForMandate(enforcer, receipt);

  // coverage + defense recommendation, from facts the journal can prove
  const captureId = receipt?.captureId ?? dispute.disputedTransactions?.[0]?.transaction_id;
  const fulfillment = fulfillmentFor(journal, receipt?.orderId);
  const refund = refundFor(journal, captureId);
  const facts = {
    hasLinkedReceipt: Boolean(full),
    isRecurringMandate: Boolean(full?.mandate.limits.recurrence),
    hasFulfillment: Boolean(fulfillment),
    ...(refund?.refundId ? { refundId: refund.refundId } : {}),
  };
  const coverage = coverageFor(dispute.reason, facts);
  const recommendation = recommendDefense(dispute.reason, facts);

  const pending: string[] = [];
  if (!receipt) pending.push("no linked purchase on file — run the console demo so the dispute can be tied to a receipt");
  if (receipt && !fulfillment) {
    pending.push("fulfillment evidence not yet attached — POST /api/orders/:orderId/fulfillment (carrier + tracking) fills the PROOF_OF_FULFILLMENT slot");
  }

  const pack: EvidencePack = {
    packId: packFileId(dispute.disputeId),
    generatedAt: new Date().toISOString(),
    generator: "carte-blanche v0.2.0",
    dispute: {
      disputeId: dispute.disputeId,
      reason: dispute.reason,
      status: dispute.status,
      openedAt: dispute.openedAt,
      respondBy: dispute.respondBy,
      source: dispute.source,
      requestedAmount: dispute.amount,
      requestedCurrency: dispute.currency,
    },
    chain: journal.verify(),
    enforcement: {
      signedRefusals: denials.map((d) => ({ denialId: d.denialId, reasonCode: d.reasonCode, createdAt: d.createdAt })),
    },
    coverage,
    recommendation,
    ...(fulfillment ? { fulfillment } : {}),
    ...(refund ? { refund } : {}),
    pending,
  };

  if (full) {
    pack.linkedPurchase = {
      receipt: full.receipt,
      mandateId: full.mandate.id,
      mandateSignature: full.mandateSignature,
      mandatePublicKey: full.mandatePublicKey,
      eventSeqs: full.events.map((e) => e.seq),
    };
    void store;
  }
  return pack;
}

export function toMarkdown(pack: EvidencePack): string {
  const d = pack.dispute;
  const lines: string[] = [];
  lines.push(`# Dispute evidence pack — ${d.disputeId}`);
  lines.push("");
  lines.push(`Generated ${pack.generatedAt} by ${pack.generator} · rails: ${d.source}`);
  lines.push("");
  lines.push("## 1. Summary");
  lines.push(`- Dispute **${d.disputeId}** — reason \`${d.reason}\`, status \`${d.status}\`, opened ${d.openedAt ?? "unknown"}, respond-by ${d.respondBy ?? "unknown"}`);
  if (d.requestedAmount) lines.push(`- Requested amount: ${d.requestedAmount} ${d.requestedCurrency ?? ""}`);
  lines.push("");

  const lp = pack.linkedPurchase;
  if (lp) {
    const r = lp.receipt;
    lines.push("## 2. The purchase happened under a signed spending mandate");
    lines.push(`- Receipt \`${r.receiptId}\`: ${r.amount} ${r.currency} for “${r.description}” on ${r.createdAt}`);
    lines.push(`- PayPal order \`${r.orderId}\`, capture \`${r.captureId}\`, status ${r.status}`);
    lines.push(`- Mandate \`${lp.mandateId}\` — signed with Ed25519 over canonical JSON`);
    lines.push(`  - signature: \`${lp.mandateSignature.slice(0, 48)}…\``);
    lines.push(`  - signer fingerprint: \`${sha256Hex(lp.mandatePublicKey).slice(0, 16)}\``);
    lines.push("  - the mandate is immutable; enforcement was demonstrably live on it (see §4)");
    lines.push("");
    lines.push("## 3. Journal evidence (tamper-evident)");
    lines.push(`- ${pack.chain.length} events in the append-only SHA-256 chain; chain verified at generation: **${pack.chain.ok ? "OK" : `BROKEN at ${pack.chain.brokenAt}`}**`);
    lines.push(`- Chain tip: \`${pack.chain.tip}\``);
    lines.push(`- Events for this purchase: seq ${lp.eventSeqs.join(" → ")} (intent → order created → captured)`);
    lines.push("");

    const n = pack.enforcement.signedRefusals.length;
    lines.push("## 4. Enforcement was live (signed refusals)");
    if (n > 0) {
      lines.push(`${n} signed proof(s) of refusal exist on this mandate, e.g.:`);
      for (const x of pack.enforcement.signedRefusals.slice(0, 3)) {
        lines.push(`- \`${x.denialId}\` [${x.reasonCode}] at ${x.createdAt}`);
      }
    } else {
      lines.push("- no refusal recorded on this mandate (agent stayed inside limits)");
    }
    lines.push("");
  } else {
    lines.push("## 2. Linked purchase");
    lines.push("- **none on file** — the cockpit cannot tie this dispute to a receipt yet");
    lines.push("");
  }

  const rec = pack.recommendation;
  lines.push(`## 5. Defense recommendation: **${rec.action}**`);
  lines.push(`- ${rec.because}`);
  lines.push(`- Evidence coverage vs PayPal's matrix for reason \`${pack.coverage.reason}\`: **${pack.coverage.covered}/${pack.coverage.total} required slots covered**`);
  for (const s of pack.coverage.slots) {
    lines.push(`  - ${s.status === "covered" ? "✓" : "✗"} \`${s.evidenceType}\` — ${s.expects}${s.how ? ` (${s.how})` : ""}`);
  }
  lines.push("");

  if (pack.pending.length > 0) {
    lines.push("## Pending (honestly)");
    for (const p of pack.pending) lines.push(`- ${p}`);
    lines.push("");
  }

  lines.push("## How anyone can verify this pack");
  if (lp) {
    lines.push(`- Open \`GET /api/verify/receipts/${lp.receipt.receiptId}\` — recomputes every hash and signature`);
    lines.push(`- Or clone the repo and run \`npm run demo\`: same crypto, fresh keys`);
  } else {
    lines.push("- Run `npm run demo` in the repo — same crypto pipeline");
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Evidence entries shaped for PayPal's provide-evidence endpoint — targeted at
 * the slots PayPal's OWN guidance asks for (developer.paypal.com/disputes/
 * reasons-evidence): OTHER (notes/documents), PROOF_OF_FULFILLMENT (structured
 * tracking_info), PROOF_OF_REFUND (refund id). The signed mandate, the chain
 * proof and the refusals all travel inside the OTHER notes; a refund entry
 * appears only when a refund was actually issued — claiming a refund slot
 * without a refund would poison the case.
 */
export function toProvideEvidenceEntries(pack: EvidencePack): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];

  if (pack.fulfillment && pack.coverage.slots.some((s) => s.evidenceType === "PROOF_OF_FULFILLMENT")) {
    entries.push({
      evidence_type: "PROOF_OF_FULFILLMENT",
      evidence_info: {
        tracking_info: [{ carrier_name: pack.fulfillment.carrier, tracking_number: pack.fulfillment.trackingNumber }],
      },
      notes: `shipped ${pack.fulfillment.shippedAt} — journalled at seq ${pack.fulfillment.seq} (tamper-evident chain)`,
    });
  }

  if (pack.refund?.refundId) {
    entries.push({
      evidence_type: "PROOF_OF_REFUND",
      evidence_info: { refund_ids: [pack.refund.refundId] },
      notes: "refund issued and journalled in the tamper-evident chain",
    });
  }

  const lp = pack.linkedPurchase;
  const authProof = lp
    ? `Authorization proof: mandate ${lp.mandateId} — Ed25519 signature ${lp.mandateSignature.slice(0, 48)}… over the mandate's canonical JSON (immutable, per-transaction and cumulative caps, payee allowlist, window${lp.receipt.payee ? `, payee ${lp.receipt.payee}` : ""}). Signer fingerprint ${sha256Hex(lp.mandatePublicKey).slice(0, 16)}. Enforcer's PayPal order ${lp.receipt.orderId} / capture ${lp.receipt.captureId}, all events seq ${lp.eventSeqs.join(" → ")} in a ${pack.chain.length}-event hash-chained journal (verified at generation, chain tip ${pack.chain.tip}).`
    : "No signed mandate on file for this transaction.";
  entries.push({
    evidence_type: "OTHER",
    notes: `${toMarkdown(pack)}
Authorization evidence (this transaction): ${authProof}`,
  });

  return entries;
}
