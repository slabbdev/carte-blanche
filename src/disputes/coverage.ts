/**
 * The seller's defense brain. PayPal's own guidance (developer.paypal.com/
 * disputes/reasons-evidence) asks for exactly THREE evidence kinds per dispute
 * reason: PROOF_OF_FULFILLMENT (carrier + tracking), PROOF_OF_REFUND (refund
 * id), or OTHER (notes/documents). This module maps each dispute's reason to
 * its required slots, scores which of them the Carte Blanche pack FILLS with
 * signed artifacts, and turns that into a fight-or-refund recommendation —
 * the fight-vs-refund dilemma, answered by evidence coverage instead of gut.
 *
 * Dig result baked in: PayPal's guidance page uses only PROOF_OF_FULFILLMENT /
 * PROOF_OF_REFUND / OTHER. Earlier integrations submitted PROOF_OF_TRANSACTION
 * or PROOF_OF_PERMISSION — types their adjudication flow does not ask for.
 */

export type EvidenceSlotType = "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND" | "OTHER";

export interface RequiredSlot {
  evidenceType: EvidenceSlotType;
  /** What PayPal expects in this slot, in their words (short). */
  expects: string;
}

/** Reasons as spelled by the guidance page AND by the Disputes v1 API enum. */
const MATRIX: Record<string, RequiredSlot[]> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: [
    { evidenceType: "PROOF_OF_FULFILLMENT", expects: "carrier name + tracking number, or proof of delivery/receipt" },
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
  ],
  ITEM_NOT_RECEIVED: [
    { evidenceType: "PROOF_OF_FULFILLMENT", expects: "carrier name + tracking number, or proof of delivery/receipt" },
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
  ],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: [
    { evidenceType: "OTHER", expects: "product description, item URL, return policy, contract" },
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
  ],
  ITEM_NOT_AS_DESCRIBED: [
    { evidenceType: "OTHER", expects: "product description, item URL, return policy, contract" },
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
  ],
  UNAUTHORISED: [
    { evidenceType: "PROOF_OF_FULFILLMENT", expects: "carrier name + tracking number" },
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
    { evidenceType: "OTHER", expects: "proof of delivery signature, receipt copy — or PROOF THE ACCOUNT HOLDER AUTHORIZED THE PURCHASE" },
  ],
  UNAUTHORIZED_TRANSACTION: [
    { evidenceType: "PROOF_OF_FULFILLMENT", expects: "carrier name + tracking number" },
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
    { evidenceType: "OTHER", expects: "proof of delivery signature, receipt copy — or PROOF THE ACCOUNT HOLDER AUTHORIZED THE PURCHASE" },
  ],
  CANCELED_RECURRING_BILLING: [
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id for the amount difference" },
    { evidenceType: "OTHER", expects: "the subscription agreement / billing terms the buyer accepted" },
  ],
  CREDIT_NOT_PROCESSED: [
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
    { evidenceType: "OTHER", expects: "credit due reason" },
  ],
  DUPLICATE_TRANSACTION: [
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
    { evidenceType: "OTHER", expects: "notes" },
  ],
  INCORRECT_AMOUNT: [
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id for the difference" },
    { evidenceType: "OTHER", expects: "price difference reason" },
  ],
  PAYMENT_BY_OTHER_MEANS: [
    { evidenceType: "PROOF_OF_REFUND", expects: "refund id for the amount difference" },
    { evidenceType: "OTHER", expects: "notes" },
  ],
};

const FALLBACK: RequiredSlot[] = [
  { evidenceType: "PROOF_OF_REFUND", expects: "refund id" },
  { evidenceType: "OTHER", expects: "notes or documents" },
];

export function requiredEvidenceFor(reason: string): RequiredSlot[] {
  return MATRIX[reason.toUpperCase()] ?? FALLBACK;
}

export interface CoverageFacts {
  /** The dispute links to a Carte Blanche receipt under a signed mandate. */
  hasLinkedReceipt: boolean;
  /** The mandate is recurring — its signed limits ARE the billing agreement. */
  isRecurringMandate: boolean;
  /** A journalled fulfillment record (carrier + tracking) exists for the order. */
  hasFulfillment: boolean;
  /** A refund was already issued (journalled) for this capture. */
  refundId?: string;
}

export interface CoverageSlot extends RequiredSlot {
  status: "covered" | "missing";
  /** How our artifacts fill the slot. */
  how?: string;
}

export interface Coverage {
  reason: string;
  slots: CoverageSlot[];
  covered: number;
  total: number;
}

/** Which required slots our signed artifacts can fill, per PayPal's matrix. */
export function coverageFor(reason: string, facts: CoverageFacts): Coverage {
  const slots = requiredEvidenceFor(reason).map((s): CoverageSlot => {
    if (s.evidenceType === "OTHER") {
      const how = facts.hasLinkedReceipt
        ? facts.isRecurringMandate
          ? "covered: the signed recurring mandate IS the billing agreement (limits, cadence, payees) + the evidence pack notes with the chain proof"
          : "covered: signed mandate (authorization) + receipt + tamper-evident journal proof in the pack notes"
        : "partial: pack notes only (no linked signed mandate on this transaction)";
      return { ...s, status: facts.hasLinkedReceipt ? "covered" : "missing", how };
    }
    if (s.evidenceType === "PROOF_OF_FULFILLMENT") {
      return {
        ...s,
        status: facts.hasFulfillment ? "covered" : "missing",
        how: facts.hasFulfillment
          ? "covered: journalled fulfillment record (carrier + tracking number), structured for tracking_info"
          : "missing: no fulfillment record — POST /api/orders/:orderId/fulfillment (carrier + tracking) before responding",
      };
    }
    return {
      ...s,
      status: facts.refundId ? "covered" : "missing",
      how: facts.refundId
        ? `covered: refund ${facts.refundId} (journalled)`
        : "missing: no refund on file (expected only if refunding is the chosen path)",
    };
  });
  // PROOF_OF_REFUND is the "settle instead of fight" slot: a missing refund is
  // expected when fighting, so it does not count against coverage unless the
  // recommendation is refund-first.
  const counted = slots.filter((s) => !(s.evidenceType === "PROOF_OF_REFUND" && s.status === "missing"));
  return {
    reason,
    slots,
    covered: counted.filter((s) => s.status === "covered").length,
    total: counted.length,
  };
}

export type DefenseRecommendation =
  | { action: "FIGHT"; because: string }
  | { action: "REFUND_FIRST"; because: string }
  | { action: "SETTLE_EITHER"; because: string };

/**
 * The fight-vs-refund dilemma, answered by coverage. "My agent didn't order
 * this" (UNAUTHORISED) is the case a signed mandate was born to win: the
 * pack cryptographically proves the account holder authorized the purchase —
 * fight. A fulfillment case you cannot evidence is a slow loss at the
 * network's clock: refund inside the inquiry window instead (no escalation,
 * no chargeback fee, dispute rate protected).
 */
export function recommendDefense(reason: string, facts: CoverageFacts): DefenseRecommendation {
  const r = reason.toUpperCase();
  if (facts.hasLinkedReceipt && (r === "UNAUTHORISED" || r === "UNAUTHORIZED_TRANSACTION")) {
    return {
      action: "FIGHT",
      because:
        "the signed spending mandate proves the account holder authorized this purchase and that enforcement was live — this is the unfalsifiable claim the pack falsifies",
    };
  }
  if (facts.isRecurringMandate && r === "CANCELED_RECURRING_BILLING") {
    return {
      action: "FIGHT",
      because: "the signed recurring mandate is the subscription agreement PayPal asks for — cadence, limits and payees are in the buyer's own signature",
    };
  }
  const cov = coverageFor(reason, facts);
  const fulfillmentMissing = cov.slots.some((s) => s.evidenceType === "PROOF_OF_FULFILLMENT" && s.status === "missing");
  if (fulfillmentMissing) {
    return {
      action: "REFUND_FIRST",
      because:
        "you cannot fill PROOF_OF_FULFILLMENT on this reason — refunding inside the inquiry window settles the case without escalation or the chargeback fee ($15–30) and protects the dispute rate",
    };
  }
  return {
    action: cov.covered === cov.total ? "FIGHT" : "SETTLE_EITHER",
    because:
      cov.covered === cov.total
        ? `the pack covers ${cov.covered}/${cov.total} required evidence slots`
        : `coverage is partial (${cov.covered}/${cov.total}) — weigh the amount against the response effort`,
  };
}
