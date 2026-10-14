/**
 * Tool definitions handed to the LLM. These are the ONLY payment actions an
 * agent can take: every one of them goes through the Carte Blanche enforcer,
 * so "the model decided to spend" and "money moved" are never conflated —
 * the mandate decides, and the model gets a signed receipt or a signed refusal.
 */
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "mandate_status",
      description:
        "Get the spending mandate you operate under: limits, window, payee allowlist, revocation status. Call this before spending.",
      parameters: {
        type: "object",
        properties: {
          mandate_id: { type: "string", description: "The mandate id you were assigned" },
        },
        required: ["mandate_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "purchase",
      description:
        "Attempt a purchase under your mandate. Returns a signed receipt if allowed, or a signed proof of refusal explaining which limit blocked it. There is no other way to move money.",
      parameters: {
        type: "object",
        properties: {
          mandate_id: { type: "string", description: "The mandate id you were assigned" },
          amount: { type: "string", description: "Decimal amount, e.g. \"12.50\"" },
          currency: { type: "string", description: "ISO 4217 code, e.g. USD" },
          description: { type: "string", description: "What this purchase is for (appears on the receipt)" },
          payee: { type: "string", description: "Optional payee email/merchant id" },
        },
        required: ["mandate_id", "amount", "currency", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "my_receipts",
      description: "List the receipts and refusals issued to you under a mandate.",
      parameters: {
        type: "object",
        properties: {
          mandate_id: { type: "string" },
        },
        required: ["mandate_id"],
      },
    },
  },
] as const;

export interface AgentToolContext {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<string> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const json = async (path: string, init?: RequestInit): Promise<unknown> => {
    const res = await doFetch(`${ctx.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    return res.json();
  };
  switch (name) {
    case "mandate_status":
      return JSON.stringify(await json(`/api/mandates/${encodeURIComponent(String(args.mandate_id))}`));
    case "purchase":
      return JSON.stringify(
        await json("/api/agent/purchase", {
          method: "POST",
          body: JSON.stringify({
            mandate_id: args.mandate_id,
            amount: args.amount,
            currency: args.currency,
            description: args.description,
            payee: args.payee,
          }),
        }),
      );
    case "save_preference":
      return JSON.stringify(
        await json("/api/agent/preferences", {
          method: "POST",
          body: JSON.stringify({ key: args.key, value: args.value, why: args.why }),
        }),
      );
    case "recall_preferences":
      return JSON.stringify(await json("/api/agent/preferences"));
    case "my_receipts":
      return JSON.stringify(
        await json(`/api/receipts?mandate_id=${encodeURIComponent(String(args.mandate_id))}`),
      );
    default:
      return JSON.stringify({ error: `unknown tool: ${name}` });
  }
}
