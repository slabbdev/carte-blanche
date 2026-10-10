import { canonicalJson } from "../lib/canonical.js";
import { sha256Hex } from "../lib/sign.js";
import type { Enforcer } from "../enforcer/enforcer.js";
import type { Journal, ChainVerification } from "../journal/journal.js";
import type { MandateStore } from "../mandate/store.js";
import type { Receipt } from "../receipts/receipts.js";
import { denialsForMandate, type DisputeView } from "./service.js";

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
  pending: string[];
}

export function buildEvidencePack(
  dispute: DisputeView,
  deps: { enforcer: Enforcer; journal: Journal; store: MandateStore },
): EvidencePack {
  const { enforcer, journal, store } = deps;
  const receipt = dispute.linkedReceiptId ? enforcer.listReceipts().find((r) => r.receiptId === dispute.linkedReceiptId) : undefined;
  const full = receipt ? enforcer.fullReceipt(receipt.receiptId) : undefined;
  const denials = denialsForMandate(enforcer, receipt);

  const pending: string[] = [];
  if (!receipt) pending.push("no linked purchase on file — run the console demo so the dispute can be tied to a receipt");
  if (receipt) pending.push("classic fulfillment evidence (tracking, correspondence) not yet attached — S3 milestone, not claimed here");

  const pack: EvidencePack = {
    packId: `pack-${dispute.disputeId}`,
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

/** Evidence entries shaped for PayPal's provide-evidence endpoint (notes-based; files are an account-manager scope). */
export function toProvideEvidenceEntries(pack: EvidencePack): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const lp = pack.linkedPurchase;
  entries.push({
    evidence_type: "PROOF_OF_TRANSACTION",
    notes: toMarkdown(pack),
  });
  if (lp) {
    entries.push({
      evidence_type: "PROOF_OF_PERMISSION" as string & { custom?: string },
      notes: canonicalJson({
        mandate_id: lp.mandateId,
        mandate_signature: lp.mandateSignature,
        receipt_id: lp.receipt.receiptId,
        chain_tip: pack.chain.tip,
      }),
    });
  }
  return entries;
}
