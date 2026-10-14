/**
 * Carte Blanche MCP server — the evidence layer as agent tools.
 *
 * Speaks stdio MCP (Claude Desktop, Claude Code, any MCP client). Every tool
 * hits the Carte Blanche HTTP API, which means every mutative call still goes
 * through the enforcer: the model gets a signed receipt or a signed refusal,
 * never direct rail access. Point CB_BASE_URL at any instance (default
 * http://localhost:8790).
 *
 * Run: npm run mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.CB_BASE_URL ?? "http://localhost:8790";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

const server = new McpServer({ name: "carte-blanche", version: "0.5.0" });

server.tool(
  "healthz",
  "Check the Carte Blanche instance: rails mode (mock/sandbox) and sealed-journal length.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await api("/healthz"), null, 2) }] }),
);

server.tool(
  "search_catalog",
  "Search the product catalog for real retail offers (title, price, merchant domain, per-merchant offers). Use it to find what the principal asked for before proposing or purchasing.",
  { q: z.string().describe("Free-text product query, e.g. 'mechanical keyboard'") },
  async ({ q }) => ({ content: [{ type: "text", text: JSON.stringify(await api(`/api/catalog?q=${encodeURIComponent(q)}`), null, 2) }] }),
);

server.tool(
  "grant_mandate",
  "Grant a signed spending mandate to an agent. Immutable once created: per-transaction cap, total cap, currency, optional payee allowlist, 7-day window. Only revocation changes it afterwards.",
  {
    principal: z.string().describe("Who grants the authority (the human)"),
    agent: z.string().describe("Who may act under it (the agent)"),
    purpose: z.string().describe("Human-readable scope, e.g. 'office supplies this week'"),
    currency: z.string().describe("ISO 4217, e.g. USD"),
    max_per_transaction: z.string().describe("Decimal cap per single purchase, e.g. '79.00'"),
    max_total_spend: z.string().describe("Decimal cumulative cap, e.g. '120.00'"),
    payees: z.array(z.string()).optional().describe("Optional allowlist of payee emails/merchant domains"),
  },
  async (a) => ({
    content: [{ type: "text", text: JSON.stringify(await api("/api/mandates", { method: "POST", body: JSON.stringify(a) }), null, 2) }],
  }),
);

server.tool(
  "mandate_status",
  "Read a mandate: limits, window, payee allowlist, revocation status, captured spend. ALWAYS call this before spending.",
  { mandate_id: z.string() },
  async ({ mandate_id }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/mandates/${encodeURIComponent(mandate_id)}`), null, 2) }],
  }),
);

server.tool(
  "revoke_mandate",
  "Revoke a mandate immediately. Revocation is journalled and the only way to change behavior after issuance — use it when the principal withdraws authority.",
  { mandate_id: z.string(), reason: z.string().optional() },
  async ({ mandate_id, reason }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/mandates/${encodeURIComponent(mandate_id)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }), null, 2) }],
  }),
);

server.tool(
  "purchase",
  "Attempt a purchase under a mandate. Returns a signed receipt if allowed, or a signed proof of refusal naming the blocking limit (OVER_PER_TRANSACTION, OVER_TOTAL_CAP, PAYEE_NOT_ALLOWED, MANDATE_REVOKED...). A refusal is final signed evidence of the principal's decision — report it, never try to work around it.",
  {
    mandate_id: z.string(),
    amount: z.string().describe("Decimal amount, e.g. '59.99'"),
    currency: z.string().describe("ISO 4217, e.g. USD"),
    description: z.string().describe("What this purchase is for (appears on the receipt)"),
    payee: z.string().optional().describe("Payee email or merchant domain; must be on the mandate allowlist when one is set"),
  },
  async (a) => ({
    content: [{ type: "text", text: JSON.stringify(await api("/api/agent/purchase", { method: "POST", body: JSON.stringify(a) }), null, 2) }],
  }),
);

server.tool(
  "my_artifacts",
  "List the signed receipts and signed refusals issued under a mandate.",
  { mandate_id: z.string().optional() },
  async ({ mandate_id }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/receipts${mandate_id ? `?mandate_id=${encodeURIComponent(mandate_id)}` : ""}`), null, 2) }],
  }),
);

server.tool(
  "verify_artifact",
  "Full public verification of a receipt or refusal: re-checks signatures, the Merkle inclusion proof and the sealed chain. Use it to prove an outcome to the principal or a third party — no account needed.",
  { kind: z.enum(["receipts", "denials"]), id: z.string().describe("rcpt-... or deny-...") },
  async ({ kind, id }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/verify/${kind}/${encodeURIComponent(id)}`), null, 2) }],
  }),
);

server.tool(
  "agent_track_record",
  "Fetch an agent's signed track record from the sealed chain: purchases captured, spend, refusals honored (by reason). Merchants check this before accepting agent orders; include it when proving your trustworthiness to the principal.",
  { agent: z.string().describe("The agent name the mandates were issued to") },
  async ({ agent }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/agents/${encodeURIComponent(agent)}/track-record`), null, 2) }],
  }),
);

server.tool(
  "recall_preferences",
  "Read everything remembered about the principal: saved tastes, tiers, trusted merchants, standing notes. ALWAYS call before proposing or buying anything.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await api("/api/agent/preferences"), null, 2) }] }),
);

server.tool(
  "save_preference",
  "Remember a durable fact about the principal (tier, trusted merchants, brands to avoid, standing instructions). Journalled — choices stay auditable.",
  {
    key: z.string().describe("Short key, e.g. 'hardware.tier'"),
    value: z.string().describe("The fact, e.g. 'mid-range, Keychron-class'"),
    why: z.string().optional().describe("One-line context for the journal"),
  },
  async (a) => ({
    content: [{ type: "text", text: JSON.stringify(await api("/api/agent/preferences", { method: "POST", body: JSON.stringify(a) }), null, 2) }],
  }),
);

server.tool(
  "plan_journey",
  "Plan a purchase journey: a basket of catalog lines (title, price, merchant domain) that becomes ONE signed mandate on approval — allowlist from the lines' merchants, caps derived from the basket.",
  {
    name: z.string(),
    currency: z.string().describe("ISO 4217, e.g. USD"),
    items: z.array(z.object({
      title: z.string(),
      price: z.string().describe("Decimal unit price"),
      merchant: z.string().optional().describe("Merchant domain, e.g. 'keychron.com'"),
      quantity: z.number().optional(),
    })).min(1),
  },
  async (a) => ({
    content: [{ type: "text", text: JSON.stringify(await api("/api/journeys", { method: "POST", body: JSON.stringify(a) }), null, 2) }],
  }),
);

server.tool(
  "approve_journey",
  "The human challenge for a basket: derives the mandate from the journey and signs it. After this, lines added to the journey still meet the signed walls.",
  { journey_id: z.string() },
  async ({ journey_id }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/journeys/${encodeURIComponent(journey_id)}/approve`, { method: "POST", body: "{}" }), null, 2) }],
  }),
);

server.tool(
  "run_journey",
  "Execute every planned line of an approved journey through the enforcer. Returns per-line outcomes: signed receipts for allowed lines, signed refusals for lines hitting a wall.",
  { journey_id: z.string() },
  async ({ journey_id }) => ({
    content: [{ type: "text", text: JSON.stringify(await api(`/api/journeys/${encodeURIComponent(journey_id)}/run`, { method: "POST" }), null, 2) }],
  }),
);

await server.connect(new StdioServerTransport());
console.error(`carte-blanche MCP server ready (${BASE})`);
