import type { Enforcer } from "../enforcer/enforcer.js";
import type { Journal } from "../journal/journal.js";
import { parseAmount } from "../mandate/mandate.js";
import type { Denial, FullDenial } from "../receipts/receipts.js";
import { sha256Hex } from "../lib/sign.js";
import type { UpstreamLike, UpstreamTool } from "./paypalMcpUpstream.js";

/**
 * The wall in front of PayPal's own agent tools.
 *
 * PayPal's MCP server hands an agent `create_order`, `pay_order`,
 * `create_refund` and 25 other tools with no notion of who authorised what.
 * The gateway re-exposes the same tools, unchanged, with one rule: nothing is
 * forwarded without a live signed mandate, and every call that moves money is
 * measured against the mandate's walls first. A refusal is the same signed
 * denial a Carte Blanche purchase gets — verifiable at /verify — and money that
 * does move is journalled as `external_spend`, which the caps count.
 *
 *   read  — list_/get_/show_/generate_: forwarded under a live mandate, journalled
 *   write — everything that changes PayPal state without moving money
 *           (invoices, products, plans, tracking, dispute acceptance): live mandate required
 *   spend — create_order / pay_order / create_refund: the money walls apply
 */

export type ToolClass = "read" | "write" | "spend";

export const SPEND_TOOLS = new Set(["create_order", "pay_order", "create_refund"]);
/** Spend tools where the money actually leaves at this call (and is counted against the caps). */
export const COUNTED_TOOLS = new Set(["pay_order", "create_refund"]);

export function classifyTool(name: string): ToolClass {
  if (SPEND_TOOLS.has(name)) return "spend";
  if (/^(list|get|show|generate)_/.test(name)) return "read";
  return "write";
}

export interface Money {
  amount: string;
  currency: string;
  payee?: string;
}

const money2 = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

/** `create_order` in PayPal's toolkit shape: items × cost (+ tax) + shipping − discount. */
export function moneyOfCreateOrder(args: Record<string, unknown>): Money | { error: string } {
  const items = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
  if (items.length === 0) return { error: "create_order without items: no amount to measure against the mandate" };
  let total = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? 1);
    const cost = Number(it.itemCost);
    const lineTotal = it.itemTotal !== undefined ? Number(it.itemTotal) : cost * qty;
    if (!Number.isFinite(lineTotal) || lineTotal < 0) return { error: `item "${String(it.name ?? "?")}" has no usable cost` };
    const taxPct = Number(it.taxPercent ?? 0);
    total += lineTotal * (1 + (Number.isFinite(taxPct) ? taxPct : 0) / 100);
  }
  total += Number(args.shippingCost ?? 0) || 0;
  total -= Number(args.discount ?? 0) || 0;
  if (!Number.isFinite(total) || total < 0) return { error: "order total is not a finite non-negative amount" };
  return { amount: money2(total), currency: String(args.currencyCode ?? "USD") };
}

/** `create_refund`: the explicit amount, or fail closed — a mandate cannot cover "whatever the capture was". */
export function moneyOfCreateRefund(args: Record<string, unknown>): Money | { error: string } {
  const amt = args.amount as { value?: unknown; currency_code?: unknown } | undefined;
  if (!amt || amt.value === undefined) {
    return { error: "create_refund without an explicit amount: under a mandate the refund amount must be stated (full-capture refunds are not measurable before the fact)" };
  }
  const value = Number(amt.value);
  if (!Number.isFinite(value) || value <= 0) return { error: "refund amount is not a positive number" };
  return { amount: money2(value), currency: String(amt.currency_code ?? "USD") };
}

/** `pay_order` names only an id: the amount is read back from PayPal (get_order) before the walls run. */
export async function moneyOfPayOrder(
  args: Record<string, unknown>,
  lookup: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<Money | { error: string }> {
  const id = String(args.id ?? "");
  if (!id) return { error: "pay_order without an order id" };
  let order: unknown;
  try {
    order = await lookup("get_order", { id });
  } catch (e) {
    return { error: `could not read order ${id} before paying it: ${(e as Error).message}` };
  }
  const pu = (order as { purchase_units?: Array<Record<string, unknown>> } | undefined)?.purchase_units?.[0];
  const amount = pu?.amount as { value?: unknown; currency_code?: unknown } | undefined;
  if (!amount?.value) return { error: `order ${id} has no readable amount — refusing to capture blind` };
  const payee = (pu?.payee as { email_address?: string; merchant_id?: string } | undefined);
  return {
    amount: money2(Number(amount.value)),
    currency: String(amount.currency_code ?? "USD"),
    ...(payee?.email_address ? { payee: payee.email_address } : payee?.merchant_id ? { payee: payee.merchant_id } : {}),
  };
}

export interface GatewayRequest {
  tool: string;
  arguments: Record<string, unknown>;
  mandateId?: string;
  intent?: { text: string; channel?: string; sessionRef?: string };
  agentProof?: { agentId: string; signature: string; ts: string };
  logicalKey?: string;
}

export interface GatewayEvidence {
  logicalKey: string;
  mandateId: string;
  chainTip: string;
  journalLength: number;
  money?: Money;
  /** true when this call moved money and was counted against the mandate's caps */
  counted: boolean;
}

export type GatewayOutcome =
  | { kind: "forwarded"; tool: string; class: ToolClass; result: unknown; resultText: string; upstreamError: boolean; evidence: GatewayEvidence }
  | { kind: "denial"; tool: string; class: ToolClass; denial: Denial; full: FullDenial };

export class PayPalToolGateway {
  private toolCache?: { at: number; tools: Array<UpstreamTool & { class: ToolClass; requiresMandate: true }> };
  private readonly memo = new Map<string, GatewayOutcome>();

  constructor(
    private readonly upstream: UpstreamLike,
    private readonly enforcer: Enforcer,
    private readonly journal: Journal,
  ) {}

  async tools(): Promise<Array<UpstreamTool & { class: ToolClass; requiresMandate: true }>> {
    if (this.toolCache && Date.now() - this.toolCache.at < 10 * 60_000) return this.toolCache.tools;
    const tools = (await this.upstream.listTools()).map((t) => ({ ...t, class: classifyTool(t.name), requiresMandate: true as const }));
    this.toolCache = { at: Date.now(), tools };
    return tools;
  }

  async invoke(req: GatewayRequest): Promise<GatewayOutcome> {
    const cls = classifyTool(req.tool);
    const mandateId = req.mandateId ?? "";
    const logicalKey = req.logicalKey ?? sha256Hex(JSON.stringify([req.tool, req.arguments, mandateId])).slice(0, 32);
    const memoed = this.memo.get(logicalKey);
    if (memoed) return memoed;

    const description = `[paypal-mcp] ${req.tool}`;
    let money: Money | undefined;
    let moneyError: string | undefined;
    if (cls === "spend") {
      const m =
        req.tool === "create_order" ? moneyOfCreateOrder(req.arguments)
        : req.tool === "create_refund" ? moneyOfCreateRefund(req.arguments)
        : await moneyOfPayOrder(req.arguments, async (tool, args) => {
            const r = await this.upstream.callTool(tool, args);
            if (r.isError) throw new Error(r.text.slice(0, 200));
            return r.json;
          });
      if ("error" in m) moneyError = m.error;
      else money = m;
    }

    // Fail closed: a spend whose amount cannot be established is refused as an
    // invalid amount, with the reason spelled out on the signed denial.
    const auth = await this.enforcer.authorize({
      mandateId,
      description: moneyError ? `${description} — ${moneyError}` : description,
      logicalKey,
      intent: req.intent,
      agentProof: req.agentProof,
      ...(cls === "spend"
        // unmeasurable → the mandate's own currency, so the walls reach INVALID_AMOUNT and say why
        ? { amount: money?.amount ?? "unmeasurable", currency: money?.currency, payee: money?.payee }
        : {}),
    });
    if (auth.kind === "denial") {
      const out: GatewayOutcome = { kind: "denial", tool: req.tool, class: cls, denial: auth.denial, full: auth.full };
      this.memo.set(logicalKey, out);
      return out;
    }

    this.journal.append("external_call_authorized", {
      mandate_id: mandateId,
      logical_key: logicalKey,
      tool: req.tool,
      tool_class: cls,
      upstream: "@paypal/mcp",
      ...(money ? { amount: money.amount, amount_minor: auth.amountMinor.toString(), currency: money.currency, payee: money.payee } : {}),
      ...(auth.executedBy ? { executed_by: auth.executedBy } : {}),
      ...(req.intent ? {
        activation: {
          text: req.intent.text.slice(0, 400),
          text_hash: sha256Hex(req.intent.text.trim()),
          ...(req.intent.channel ? { channel: req.intent.channel } : {}),
          ...(req.intent.sessionRef ? { session_ref: req.intent.sessionRef } : {}),
        },
      } : {}),
    });

    const result = await this.upstream.callTool(req.tool, req.arguments);
    const failed = upstreamFailed(result);
    const upstreamId = (result.json as { id?: string } | undefined)?.id;
    // Money is counted only when PayPal says it moved: a 422 "payer has not
    // approved" arrives as a perfectly well-formed JSON answer, not an MCP error.
    const counted = cls === "spend" && COUNTED_TOOLS.has(req.tool) && !failed && Boolean(money) && moneyMoved(result.json);
    if (counted && money) {
      this.journal.append("external_spend", {
        mandate_id: mandateId,
        logical_key: logicalKey,
        tool: req.tool,
        upstream: "@paypal/mcp",
        upstream_id: upstreamId ?? null,
        amount: money.amount,
        amount_minor: parseAmount(money.amount, money.currency).toString(),
        currency: money.currency,
        ...(money.payee ? { payee: money.payee } : {}),
      });
    } else {
      this.journal.append(failed ? "external_call_failed" : "external_call_completed", {
        mandate_id: mandateId,
        logical_key: logicalKey,
        tool: req.tool,
        tool_class: cls,
        upstream: "@paypal/mcp",
        upstream_id: upstreamId ?? null,
        ...(failed ? { error: result.text.slice(0, 300) } : {}),
      });
    }

    const out: GatewayOutcome = {
      kind: "forwarded",
      tool: req.tool,
      class: cls,
      result: result.json ?? result.text,
      resultText: result.text,
      upstreamError: failed,
      evidence: {
        logicalKey,
        mandateId,
        chainTip: this.journal.tip(),
        journalLength: this.journal.length,
        ...(money ? { money } : {}),
        counted,
      },
    };
    if (!failed) this.memo.set(logicalKey, out);
    return out;
  }
}

/** The toolkit reports PayPal API failures as ordinary JSON ({ ok: false, status: 422, … }), not as MCP errors. */
export function upstreamFailed(result: { isError: boolean; json?: unknown }): boolean {
  if (result.isError) return true;
  const j = result.json as { ok?: unknown; status?: unknown; error?: unknown; code?: unknown } | undefined;
  if (!j || typeof j !== "object") return false;
  if (j.ok === false) return true;
  if (typeof j.status === "number" && j.status >= 400) return true;
  if (typeof j.error === "string" || (typeof j.code === "string" && /ERROR|INVALID|FAILED/i.test(j.code))) return true;
  return false;
}

const MOVED_STATUSES = new Set(["COMPLETED", "PENDING", "CAPTURED", "APPROVED"]);
/** PayPal captures and refunds carry a status; anything else than a settled one is not a spend. */
export function moneyMoved(json: unknown): boolean {
  const status = (json as { status?: unknown } | undefined)?.status;
  return typeof status !== "string" || MOVED_STATUSES.has(status.toUpperCase());
}
