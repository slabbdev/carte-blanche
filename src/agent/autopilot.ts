import { AGENT_TOOLS, executeTool } from "./tools.js";
import { Channel3Catalog } from "../catalog/channel3.js";
import { formatAmount, parseAmount } from "../mandate/mandate.js";
import type { Enforcer } from "../enforcer/enforcer.js";
import type { Journal } from "../journal/journal.js";
import type { MandateStore } from "../mandate/store.js";
import type { CatalogProduct } from "../catalog/channel3.js";

const LLM_SYSTEM = `You are a purchasing agent operating under a strict spending mandate.
Available tools: mandate_status, purchase, my_receipts, recall_preferences, save_preference.
Rules: check the mandate first; respect every limit; if a purchase is refused, do NOT retry it —
a refusal is final signed evidence of the principal's decision; report it instead.`;

/**
 * Autopilot: run the agent ON THE SERVER, under a mandate, from one call —
 * so the front UI can drive the agent without ever holding rail access.
 *
 * Two policies, chosen by configuration:
 *  - "llm": OPENAI_API_KEY present — the model reasons over the same HTTP
 *    tools the CLI loop uses (executeTool), under the same walls.
 *  - "scripted": no key — a deterministic policy: search the catalog for the
 *    goal, pick the cheapest allowlisted offer that fits the remaining budget,
 *    buy it. The walls hold regardless of how smart the policy is.
 *
 * Either way the run is journalled (`agent_autopilot_run`) — the transcript is
 * evidence like everything else.
 */

export interface AutopilotStep {
  action: string;
  detail: string;
}

export interface AutopilotResult {
  mode: "llm" | "scripted";
  goal: string;
  mandateId: string;
  steps: AutopilotStep[];
  outcome: "receipt" | "refused" | "pending" | "none";
  artifactId?: string;
}

let deps: { journal: Journal; catalog: Channel3Catalog; store: MandateStore; baseUrl: string } | null = null;

/** Called once by the server at boot. */
export function configureAutopilot(journal: Journal, catalog: Channel3Catalog, store: MandateStore, baseUrl: string): void {
  deps = { journal, catalog, store, baseUrl };
}

export function autopilotAvailable(): { llm: boolean } {
  return { llm: Boolean(process.env.OPENAI_API_KEY) };
}

async function journalAutopilot(
  mandateId: string,
  mode: "llm" | "scripted",
  goal: string,
  steps: AutopilotStep[],
  outcome: string,
  artifactId?: string,
): Promise<void> {
  deps?.journal.append("agent_autopilot_run", {
    mandate_id: mandateId,
    mode,
    goal: goal.slice(0, 120),
    steps: steps.length,
    outcome,
    ...(artifactId ? { artifact_id: artifactId } : {}),
  });
}

// ------------------------------ scripted policy ------------------------------

export async function runScriptedPolicy(
  enforcer: Enforcer,
  opts: { mandateId: string; goal: string },
): Promise<AutopilotResult> {
  if (!deps) throw new Error("autopilot not configured");
  const steps: AutopilotStep[] = [];
  const signed = deps.store.get(opts.mandateId);
  if (!signed) throw new Error("mandate not found");
  const mandate = signed.mandate;

  steps.push({ action: "mandate_status", detail: `limits ${mandate.limits.maxPerTransaction}/${mandate.limits.maxTotalSpend} ${mandate.limits.currency} — allowlist ${(mandate.limits.payees ?? []).join(", ") || "any"}` });

  const spent = deps.journal.capturedMinorFor(opts.mandateId);
  const totalMinor = parseAmount(mandate.limits.maxTotalSpend, mandate.limits.currency);
  const perTxMinor = parseAmount(mandate.limits.maxPerTransaction, mandate.limits.currency);
  const budgetMinor = totalMinor - spent < perTxMinor ? totalMinor - spent : perTxMinor;
  if (budgetMinor <= 0n) {
    steps.push({ action: "no-budget", detail: "remaining budget is zero — nothing to do" });
    await journalAutopilot(opts.mandateId, "scripted", opts.goal, steps, "none");
    return { mode: "scripted", goal: opts.goal, mandateId: opts.mandateId, steps, outcome: "none" };
  }
  steps.push({ action: "budget", detail: `remaining ${formatAmount(totalMinor - spent, mandate.limits.currency)} — shopping under ${formatAmount(budgetMinor, mandate.limits.currency)}` });

  const search = await deps.catalog.search(opts.goal, 8);
  steps.push({ action: "catalog", detail: `${search.products.length} product(s) for "${opts.goal}" (${search.source})` });

  const allow = new Set((mandate.limits.payees ?? []).map((p) => p.toLowerCase()));
  const candidates = search.products
    .filter((p: CatalogProduct) => p.price)
    .map((p: CatalogProduct) => {
      const offer = p.offers.find((o) => allow.has((o.merchant ?? "").toLowerCase())) ?? null;
      return {
        title: p.title,
        merchant: offer?.merchant ?? p.website ?? p.offers[0]?.merchant ?? "",
        price: (offer?.price ?? (p.price as string)) as string,
        inList: allow.size === 0 || allow.has((offer?.merchant ?? p.website ?? "").toLowerCase()),
      };
    })
    .filter((c) => c.price && parseAmount(c.price, mandate.limits.currency) <= budgetMinor)
    .sort((a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price));

  const pick = candidates.find((c) => c.inList) ?? candidates[0];
  if (!pick) {
    steps.push({ action: "no-fit", detail: "nothing within budget from the catalog" });
    await journalAutopilot(opts.mandateId, "scripted", opts.goal, steps, "none");
    return { mode: "scripted", goal: opts.goal, mandateId: opts.mandateId, steps, outcome: "none" };
  }
  steps.push({
    action: "pick",
    detail: `${pick.title.slice(0, 60)} @ ${pick.price} from ${pick.merchant || "no merchant"}` +
      (pick.inList ? "" : " (NOT on the allowlist — attempting anyway; the walls decide)"),
  });

  const outcome = await enforcer.purchase({
    mandateId: opts.mandateId,
    amount: pick.price,
    currency: mandate.limits.currency,
    description: `[autopilot] ${pick.title.slice(0, 80)}`,
    ...(pick.merchant ? { payee: pick.merchant } : {}),
    // the user's prompt IS the activation — sealed with the purchase
    intent: { text: opts.goal, channel: "carte-blanche-autopilot" },
  });
  const result: AutopilotResult = {
    mode: "scripted",
    goal: opts.goal,
    mandateId: opts.mandateId,
    steps,
    outcome: outcome.kind === "receipt" ? "receipt" : outcome.kind === "denial" ? "refused" : "pending",
    ...(outcome.kind === "receipt"
      ? { artifactId: outcome.receipt.receiptId }
      : outcome.kind === "denial"
        ? { artifactId: outcome.denial.denialId }
        : {}),
  };
  steps.push({
    action: outcome.kind,
    detail: outcome.kind === "receipt"
      ? `receipt ${outcome.receipt.receiptId} (order ${outcome.receipt.orderId})`
      : outcome.kind === "denial"
        ? `${outcome.denial.reasonCode}: ${outcome.denial.reasonDetail}`
        : "awaiting buyer approval at the redirect",
  });
  await journalAutopilot(opts.mandateId, "scripted", opts.goal, steps, result.outcome, result.artifactId);
  return result;
}

// --------------------------------- llm policy ---------------------------------

interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

async function runLlmPolicy(
  enforcer: Enforcer,
  opts: { mandateId: string; goal: string },
): Promise<AutopilotResult> {
  if (!deps) throw new Error("autopilot not configured");
  const steps: AutopilotStep[] = [];
  const messages: LlmMessage[] = [
    { role: "system", content: LLM_SYSTEM },
    { role: "user", content: `${opts.goal} — your mandate is ${opts.mandateId}. Buy it if it fits; report refusals, never retry them.` },
  ];
  let outcome: AutopilotResult["outcome"] = "none";
  let artifactId: string | undefined;

  for (let round = 0; round < 8; round++) {
    const res = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages,
        tools: AGENT_TOOLS,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: Array<{ message: LlmMessage & { tool_calls?: LlmMessage["tool_calls"] } }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("empty LLM response");
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      steps.push({ action: "final", detail: (msg.content ?? "").slice(0, 200) });
      break;
    }
    for (const call of msg.tool_calls) {
      let result: string;
      try {
        result = await executeTool(call.function.name, JSON.parse(call.function.arguments || "{}"), { baseUrl: deps.baseUrl });
      } catch (e) {
        result = JSON.stringify({ error: (e as Error).message });
      }
      steps.push({ action: call.function.name, detail: result.slice(0, 160) });
      try {
        const parsed = JSON.parse(result) as { outcome?: string; receipt?: { receiptId: string }; denial?: { denialId: string } };
        if (parsed.outcome === "receipt") { outcome = "receipt"; artifactId = parsed.receipt?.receiptId; }
        if (parsed.outcome === "denial") { outcome = "refused"; artifactId = parsed.denial?.denialId; }
      } catch { /* tool output not our envelope */ }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  await journalAutopilot(opts.mandateId, "llm", opts.goal, steps, outcome, artifactId);
  return { mode: "llm", goal: opts.goal, mandateId: opts.mandateId, steps, outcome, ...(artifactId ? { artifactId } : {}) };
}

// ---------------------------------- entry ------------------------------------

export async function runAutopilot(
  enforcer: Enforcer,
  opts: { mandateId: string; goal: string },
): Promise<AutopilotResult> {
  if (process.env.OPENAI_API_KEY) return runLlmPolicy(enforcer, opts);
  return runScriptedPolicy(enforcer, opts);
}
