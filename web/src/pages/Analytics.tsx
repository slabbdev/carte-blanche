import { useEffect, useMemo, useState } from "react";
import { AgStudio, createWidgets } from "ag-studio-react";
import { AgStudioAiModule, AgStudioLicenseManager, createAiHarness } from "ag-studio";
import type { AgAiHarnessSetup, AgAiPromptStarter, AgReportState } from "ag-studio";
import { api } from "../api";
import { carteBlancheAdapter } from "../lib/studioAdapter";
import { KPI_WIDGET_ID, kpiThresholdDefinition } from "../components/KpiThresholdWidget";

/**
 * Analytics — the seller's self-serve dashboard on AG Studio.
 *
 * Six tables straight from the evidence layer and PayPal's own records feed
 * Studio's data engine; two pre-built pages open the story (seller health,
 * agent activity), and the Studio agents — running on our LLM proxy — build or
 * change widgets from a sentence. The "Threshold KPI" tile is ours: the one
 * number a merchant watches, judged against the threshold PayPal applies.
 */

const LICENSE = (import.meta as any).env?.VITE_AG_STUDIO_LICENSE_KEY as string | undefined;
if (LICENSE) AgStudioLicenseManager.setLicenseKey(LICENSE);

interface Sources {
  sales: Record<string, unknown>[];
  disputes: Record<string, unknown>[];
  receipts: Record<string, unknown>[];
  refusals: Record<string, unknown>[];
  mandates: Record<string, unknown>[];
  health: Record<string, unknown>[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const daysLeft = (iso?: unknown): number | null =>
  typeof iso === "string" && iso ? Math.ceil((Date.parse(iso) - Date.now()) / 864e5) : null;

async function loadSources(): Promise<Sources> {
  const [money, disputesRes, receiptsRes, mandatesRes] = await Promise.all([
    api<any>("/api/paypal/money?limit=500").catch(() => null),
    api<any>("/api/disputes").catch(() => ({ disputes: [] })),
    api<any>("/api/receipts").catch(() => ({ receipts: [], denials: [] })),
    api<any>("/api/mandates").catch(() => []),
  ]);

  const sales = ((money?.transactions ?? []) as any[]).map((t) => ({
    id: t.transactionId || t.date,
    date: t.date,
    day: String(t.date ?? "").slice(0, 10),
    amount: num(t.amount),
    direction: num(t.amount) >= 0 ? "in" : "out",
    currency: t.currency,
    status: t.status,
    origin: t.agentMarker ? "agent" : "human",
    agent: t.agentMarker ?? "",
    subject: t.subject ?? "",
  }));

  const disputes = ((disputesRes?.disputes ?? []) as any[]).map((d) => ({
    id: d.disputeId,
    reason: String(d.reason ?? "").toLowerCase().replaceAll("_", " "),
    status: d.status ?? "",
    stage: d.stage ?? "",
    amount: num(d.amount),
    currency: d.currency ?? "",
    opened: d.createdAt ?? d.created ?? d.openedAt ?? null,
    respondBy: d.respondBy ?? null,
    daysLeft: daysLeft(d.respondBy),
    open: !/RESOLVED/i.test(String(d.status ?? "")),
  }));

  const receipts = ((receiptsRes?.receipts ?? []) as any[]).map((r) => ({
    id: r.receiptId,
    date: r.createdAt,
    day: String(r.createdAt ?? "").slice(0, 10),
    amount: num(r.amount),
    currency: r.currency,
    merchant: r.payee ?? "(no payee)",
    mandateId: r.mandateId,
    intentSealed: Boolean(r.intent),
    description: r.description ?? "",
    status: r.status ?? "",
  }));

  const refusals = ((receiptsRes?.denials ?? []) as any[]).map((d) => ({
    id: d.denialId,
    date: d.createdAt,
    day: String(d.createdAt ?? "").slice(0, 10),
    amount: num(d.requested?.amount),
    currency: d.requested?.currency ?? "",
    merchant: d.requested?.payee ?? "(no payee)",
    mandateId: d.mandateId,
    wall: d.reasonCode ?? "",
    detail: d.reasonDetail ?? "",
  }));

  const mandates = ((Array.isArray(mandatesRes) ? mandatesRes : []) as any[]).map((s) => ({
    id: s.mandate?.id,
    agent: s.mandate?.agent ?? "",
    purpose: s.mandate?.purpose ?? "",
    currency: s.mandate?.limits?.currency ?? "",
    maxPerTransaction: num(s.mandate?.limits?.maxPerTransaction),
    maxTotalSpend: num(s.mandate?.limits?.maxTotalSpend),
    payees: (s.mandate?.limits?.payees ?? []).join(", ") || "any",
    recurring: Boolean(s.mandate?.limits?.recurrence),
    issuedAt: s.mandate?.issuedAt ?? null,
    revoked: Boolean(s.revoked),
  }));

  const txCount = num(money?.count) || sales.length;
  const openDisputes = disputes.filter((d) => d.open).length;
  const agentTx = sales.filter((s) => s.origin === "agent").length;
  const health = [{
    metric: "last 31 days",
    transactions: txCount,
    disputes: disputes.length,
    openDisputes,
    disputeRatePct: txCount > 0 ? (disputes.length / txCount) * 100 : 0,
    hotDeadlines: disputes.filter((d) => d.open && d.daysLeft !== null && d.daysLeft <= 3).length,
    agentSharePct: sales.length > 0 ? (agentTx / sales.length) * 100 : 0,
    receipts: receipts.length,
    refusalsCount: refusals.length,
    balance: num(money?.balance?.value),
    balanceCurrency: money?.balance?.currency ?? "",
  }];

  return { sales, disputes, receipts, refusals, mandates, health };
}

const DATASET_DESCRIPTION = [
  "Carte Blanche — a merchant's seller analytics on PayPal sandbox rails, with the evidence layer for AI-agent purchases.",
  "`sales`: PayPal Transaction Search rows for the last 31 days (origin = 'agent' when the order carried a Carte Blanche `cb|agent=…` custom_id marker, else 'human'; direction in/out; amount signed).",
  "`disputes`: PayPal Disputes API cases against this merchant (stage INQUIRY is PayPal's no-fee window; daysLeft = days before the respond-by deadline; open = not RESOLVED).",
  "`receipts`: agent purchases sealed by Carte Blanche (intentSealed = the buyer's words were sealed at purchase time).",
  "`refusals`: purchases the signed mandate refused before money moved; `wall` is the limit that held (OVER_PER_TRANSACTION, PAYEE_NOT_ALLOWED, OVER_TOTAL_CAP, OVER_WINDOW_CAP, MANDATE_REVOKED…).",
  "`mandates`: signed spending mandates (per-purchase cap, total cap, merchant allowlist, recurring flag, revoked flag).",
  "`health`: a one-row KPI summary; disputeRatePct is compared with PayPal's ~1.5 % dispute-rate threshold.",
].join(" ");

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Dispute rate vs PayPal's 1.5 %", prompt: "Add a Threshold KPI showing disputeRatePct from health with a 1.5 threshold, healthy when below." },
  { label: "Agent vs human sales by day", prompt: "Add a column chart of total sales amount by day, grouped by origin (agent vs human)." },
  { label: "Which walls held?", prompt: "Add a chart counting refusals by wall, and a grid of the refusals with merchant, amount and detail." },
  { label: "Cases due within 3 days", prompt: "Add a grid of open disputes with daysLeft at or below 3, sorted by daysLeft ascending." },
  { label: "Refund-spike watch", prompt: "Add a column chart of outgoing sales amounts (direction = out) by day for the last 7 days and tell me if any day looks abnormal." },
];

const kpi = (id: string, field: string, caption: string, threshold: number, goodWhen: "below" | "above", unit = "", decimals = 0) => ({
  type: KPI_WIDGET_ID,
  dataMapping: { value: [{ id: field, aggregation: "max" }] },
  format: { style: { threshold, goodWhen, unit, decimals, caption } },
});

const INITIAL_STATE: AgReportState<any> = {
  pages: [
    {
      id: "seller-health",
      widgets: {
        k1: kpi("k1", "health.disputeRatePct", "Dispute rate · PayPal threshold 1.5 %", 1.5, "below", "%", 2),
        k2: kpi("k2", "health.openDisputes", "Open disputes", 0, "below"),
        k3: kpi("k3", "health.hotDeadlines", "Cases due within 3 days", 0, "below"),
        k4: kpi("k4", "health.refusalsCount", "Walls held (signed refusals)", 0, "above"),
        c1: { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "disputes.reason" }], valueKey: [{ id: "disputes.amount", aggregation: "count" }] } },
        c2: { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "sales.day" }], valueKey: [{ id: "sales.amount", aggregation: "sum" }] } },
        g1: { type: "grid", dataMapping: { cols: [
          { id: "disputes.id" }, { id: "disputes.reason" }, { id: "disputes.stage" }, { id: "disputes.status" },
          { id: "disputes.amount" }, { id: "disputes.currency" }, { id: "disputes.respondBy" }, { id: "disputes.daysLeft" },
        ] } },
      },
      widgetLayout: {
        k1: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 6 },
        k2: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 6 },
        k3: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 6 },
        k4: { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 6 },
        c1: { xTrack: 0, yTrack: 6, xSpan: 12, ySpan: 9 },
        c2: { xTrack: 12, yTrack: 6, xSpan: 12, ySpan: 9 },
        g1: { xTrack: 0, yTrack: 15, xSpan: 24, ySpan: 9 },
      },
    },
    {
      id: "agent-activity",
      widgets: {
        a1: { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "refusals.wall" }], valueKey: [{ id: "refusals.amount", aggregation: "count" }] } },
        a2: { type: "column-chart-grouped", dataMapping: { categoryKey: [{ id: "receipts.merchant" }], valueKey: [{ id: "receipts.amount", aggregation: "sum" }] } },
        a3: { type: "grid", dataMapping: { cols: [
          { id: "receipts.id" }, { id: "receipts.date" }, { id: "receipts.merchant" }, { id: "receipts.amount" },
          { id: "receipts.currency" }, { id: "receipts.intentSealed" }, { id: "receipts.mandateId" },
        ] } },
        a4: { type: "grid", dataMapping: { cols: [
          { id: "mandates.id" }, { id: "mandates.agent" }, { id: "mandates.purpose" }, { id: "mandates.maxPerTransaction" },
          { id: "mandates.maxTotalSpend" }, { id: "mandates.payees" }, { id: "mandates.recurring" }, { id: "mandates.revoked" },
        ] } },
      },
      widgetLayout: {
        a1: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 9 },
        a2: { xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 9 },
        a3: { xTrack: 0, yTrack: 9, xSpan: 24, ySpan: 8 },
        a4: { xTrack: 0, yTrack: 17, xSpan: 24, ySpan: 7 },
      },
    },
  ],
  selectedPageId: "seller-health",
} as any;

export default function Analytics() {
  const [sources, setSources] = useState<Sources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);

  useEffect(() => {
    loadSources().then(setSources).catch((e) => setError(e.message));
    api<{ configured: boolean }>("/api/llm/status").then((s) => setLlmReady(Boolean(s.configured))).catch(() => setLlmReady(false));
  }, []);

  const data = useMemo(() => sources && ({
    description: DATASET_DESCRIPTION,
    sources: [
      { id: "sales", name: "Sales (PayPal)", description: "PayPal Transaction Search rows, last 31 days; origin agent/human from the cb| custom_id marker.", data: sources.sales },
      { id: "disputes", name: "Disputes", description: "PayPal Disputes API cases against this merchant.", data: sources.disputes },
      { id: "receipts", name: "Agent receipts", description: "Agent purchases sealed by Carte Blanche.", data: sources.receipts },
      { id: "refusals", name: "Refusals", description: "Purchases the signed mandate refused; wall = the limit that held.", data: sources.refusals },
      { id: "mandates", name: "Mandates", description: "Signed spending mandates.", data: sources.mandates },
      { id: "health", name: "Seller health", description: "One-row KPI summary for the last 31 days.", data: sources.health },
    ],
  }), [sources]);

  const widgets = useMemo(() => (widgetConfig: any) => createWidgets<any>({
    additionalTypes: [kpiThresholdDefinition],
    menu: [...(widgetConfig?.menu ?? []), { label: "Carte Blanche", widgetIds: [KPI_WIDGET_ID] }],
  } as any), []);

  const ai = useMemo<AgAiHarnessSetup>(() => {
    const adapter = carteBlancheAdapter("/api/llm/turn");
    return ({ api: studioApi }) => createAiHarness(studioApi, { adapter, promptStarters: PROMPT_STARTERS });
  }, []);

  return (
    <>
      <header className="page"><h1>Analytics</h1></header>
      <p className="statusline">
        AG Studio · {sources ? `${sources.sales.length} sales · ${sources.disputes.length} disputes · ${sources.receipts.length} receipts · ${sources.refusals.length} refusals · ${sources.mandates.length} mandates` : "loading the evidence layer…"}
        {llmReady === false && <span className="pill warn" style={{ marginLeft: 10 }}>agents offline — no LLM key on the server</span>}
        {llmReady === true && <span className="pill ok" style={{ marginLeft: 10 }}>agents online</span>}
      </p>
      <p className="sub" style={{ margin: "-14px 0 14px", color: "var(--muted)", fontSize: 12.5 }}>
        Self-serve dashboards over PayPal's records and the sealed evidence layer. Edit any widget, add one from the
        menu, or ask the agents — "dispute rate vs PayPal's 1.5 %", "which walls held?" — and they build it from the
        same six tables. The <b>Threshold KPI</b> tile is ours: one number, judged against the threshold PayPal applies.
      </p>
      {error && <div className="hint" style={{ marginBottom: 10 }}>could not load the data: {error}</div>}
      <div className="card" style={{ padding: 0, overflow: "hidden", height: "calc(100vh - 230px)", minHeight: 640 }}>
        {data ? (
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            modules={[AgStudioAiModule]}
            data={data as any}
            initialState={INITIAL_STATE}
            widgets={widgets as any}
            ai={ai}
            mode="edit"
            panels={{ edit: { left: ["ai"], right: [] } } as any}
          />
        ) : (
          <div className="empty" style={{ padding: 40 }}>loading…</div>
        )}
      </div>
    </>
  );
}
