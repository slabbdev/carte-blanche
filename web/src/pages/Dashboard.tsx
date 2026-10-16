import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { api, esc, useScript } from "../api";
import { mdToHtml } from "../lib/md";

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  accentColor: "#0070e0", borderColor: "#e7e9ee", backgroundColor: "#ffffff",
  foregroundColor: "#001f33", headerTextColor: "#566173", headerBackgroundColor: "#f7f9fc",
  oddRowBackgroundColor: "#fbfcfe", rowHoverColor: "#f0f6ff", fontFamily: "inherit",
  fontSize: 13.5, cellHorizontalPadding: 16, rowHeight: 52, wrapperBorderRadius: 0,
});

const STAGE_PLAYBOOK: Record<string, string> = {
  INQUIRY: "Buyer case inside PayPal's Resolution Center — resolve HERE: up to ~20 days, no chargeback fee, direct contact possible. Every case that escalates costs $15–30 and hits your dispute rate.",
  CHARGEBACK: "The bank is now in the loop — network deadlines are shorter and the dispute fee applies. Submit compelling evidence NOW; the pack below is already targeted at PayPal's required slots.",
  PRE_ARBITRATION: "Post-adjudication appeal window — escalate only with NEW evidence (e.g. the signed mandate's chain proof). Otherwise the adjudicated outcome stands.",
};

function daysLeft(respondBy?: string): number | null {
  if (!respondBy) return null;
  return Math.ceil((Date.parse(respondBy) - Date.now()) / 864e5);
}

export default function Dashboard() {
  const [tab, setTab] = useState<"sales" | "mine">("sales");
  const [view, setView] = useState<"grid" | "timeline">("grid");
  const [disputes, setDisputes] = useState<any[]>([]);
  const [statusline, setStatusline] = useState("loading disputes…");
  const [mineCount, setMineCount] = useState(0);
  const [current, setCurrent] = useState<any>(null);
  const [pack, setPack] = useState<any>(null);
  const [packTab, setPackTab] = useState<"md" | "json">("md");
  const [dHint, setDHint] = useState("");
  const [toolHint, setToolHint] = useState("");
  const [quick, setQuick] = useState("");
  const [rules, setRules] = useState<any[] | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleReasons, setRuleReasons] = useState("");
  const [ruleMax, setRuleMax] = useState("");
  const [ruleAction, setRuleAction] = useState("auto_refund");
  const [rulesHint, setRulesHint] = useState("");
  const gridApi = useRef<any>(null);
  const chartRefs = { status: useRef<HTMLDivElement>(null), reason: useRef<HTMLDivElement>(null) };
  const calDiv = useRef<HTMLDivElement>(null);
  const calRef = useRef<any>(null);
  const calReady = useScript("/vendor/bryntum/calendar.umd.js", () => Boolean((window as any).bryntum?.Calendar));
  const chartsReady = useScript("/vendor/charts/ag-charts-community.min.js", () => Boolean((window as any).agCharts?.AgCharts));

  const load = async () => {
    try {
      const d = await api<{ source: string; disputes: any[] }>("/api/disputes");
      setDisputes(d.disputes ?? []);
      setStatusline((d.disputes ?? []).length + " dispute(s) · " +
        (d.source === "paypal" ? "PAYPAL SANDBOX" : "MOCK RAILS") + " — pick a row for the defense kit");
    } catch (e: any) { setStatusline("error: " + e.message); }
    api("/api/my/contestations").then((d: any) => setMineCount((d.contestations ?? []).length)).catch(() => {});
  };
  useEffect(() => { load(); api("/api/disputes/rules").then((d: any) => setRules(d.rules ?? [])).catch(() => setRules([])); }, []);

  async function createRule() {
    if (!ruleName.trim()) { setRulesHint("give the rule a name"); return; }
    const reasons = ruleReasons.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    try {
      await api("/api/disputes/rules", { method: "POST", body: JSON.stringify({
        name: ruleName.trim(), reasons,
        maxAmount: ruleMax.trim() && !Number.isNaN(Number(ruleMax)) ? Number(ruleMax) : undefined,
        requireMandate: true, action: ruleAction,
      }) });
      setRuleName(""); setRuleReasons(""); setRuleMax("");
      setRulesHint("✓ rule created — it fires on Evaluate now and on every new dispute webhook");
      api("/api/disputes/rules").then((d: any) => setRules(d.rules ?? [])).catch(() => {});
    } catch (e: any) { setRulesHint("✗ " + e.message); }
  }
  async function toggleRule(id: string, active: boolean) {
    await api(`/api/disputes/rules/${encodeURIComponent(id)}/toggle`, { method: "POST", body: JSON.stringify({ active }) }).catch(() => {});
    api("/api/disputes/rules").then((d: any) => setRules(d.rules ?? [])).catch(() => {});
  }
  async function deleteRule(id: string) {
    await api(`/api/disputes/rules/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    api("/api/disputes/rules").then((d: any) => setRules(d.rules ?? [])).catch(() => {});
  }
  async function evaluateRules() {
    setRulesHint("evaluating rules against current disputes…");
    try {
      const r = await api<{ evaluated: number; actions: any[] }>("/api/disputes/rules/evaluate", { method: "POST" });
      setRulesHint(r.actions.length
        ? r.actions.map((a: any) => `${a.dispute}: ${a.action}${a.refundId ? " (refund " + a.refundId + ")" : a.simulated ? " (simulated on mock)" : a.error ? " ✗ " + a.error : ""}`).join(" · ")
        : `evaluated ${r.evaluated} dispute(s) — no rule matched`);
      await load();
    } catch (e: any) { setRulesHint("✗ " + e.message); }
  }

  // charts
  useEffect(() => {
    const Charts = (window as any).agCharts?.AgCharts;
    if (!chartsReady || !Charts || tab !== "sales") return;
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const d of disputes) {
      byStatus[d.status || "unknown"] = (byStatus[d.status || "unknown"] || 0) + 1;
      if (d.amount != null) {
        const k = (d.reason || "unknown").toLowerCase().replaceAll("_", " ");
        byReason[k] = (byReason[k] || 0) + Number(d.amount) || 0;
      }
    }
    const make = (el: HTMLDivElement | null, data: any[], xKey: string, yKey: string, fill: string) => {
      if (!el || !data.length) { if (el) el.replaceChildren(); return; }
      el.replaceChildren();
      Charts.create({ container: el, data, series: [{ type: "bar", xKey, yKey, fill }],
        axes: [{ type: "category", position: "bottom" }, { type: "number", position: "left" }], height: 190 });
    };
    make(chartRefs.status.current, Object.entries(byStatus).map(([status, count]) => ({ status, count })), "status", "count", "#0070e0");
    make(chartRefs.reason.current, Object.entries(byReason).map(([reason, total]) => ({ reason, total })), "reason", "total", "#ffc43d");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputes, tab, chartsReady]);

  // calendar
  useEffect(() => {
    if (view !== "timeline" || !calReady || !calDiv.current || calRef.current) return;
    const Calendar = (window as any).bryntum.Calendar;
    calRef.current = new Calendar({
      appendTo: calDiv.current, date: new Date(),
      resources: [{ id: "merchant", name: "Merchant disputes" }],
      events: disputes.map((d) => ({ id: d.disputeId, name: (d.reason || "dispute").toLowerCase().replaceAll("_", " "),
        resourceId: "merchant", startDate: d.respondBy ?? new Date().toISOString().slice(0, 10) })),
      modes: { agenda: { type: "agenda" }, month: true, week: true, year: false, day: false },
      eventRenderer: ({ eventRecord }: any) => "<b>" + esc(eventRecord.name) + "</b>",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, calReady]);

  async function selectDispute(d: any) {
    setCurrent(d);
    setDHint("");
    setPack(null);
    try {
      setPack(await api(`/api/disputes/${encodeURIComponent(d.disputeId)}/evidence-pack`));
    } catch (e: any) { setPack({ error: e.message }); }
    (document.getElementById("drawer") as HTMLDivElement)?.classList.add("show");
    document.getElementById("drawer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitEvidence() {
    if (!current) return;
    setDHint("submitting to PayPal…");
    try {
      const r = await api<{ ok: boolean; detail: string }>(`/api/disputes/${encodeURIComponent(current.disputeId)}/submit-evidence`, { method: "POST" });
      setDHint((r.ok ? "✓ " : "✗ ") + r.detail);
    } catch (e: any) { setDHint("✗ " + e.message); }
  }
  async function fastLane(action: "refund" | "fight") {
    if (!current) return;
    if (action === "refund" && !confirm(`Refund ${current.amount ?? "?"} ${current.currency ?? ""} on ${current.disputeId}? The case settles inside the inquiry window — no chargeback escalation, no dispute fee.`)) return;
    setDHint(action === "refund" ? "refunding…" : "preparing the pack…");
    try {
      const r = await api<any>(`/api/disputes/${encodeURIComponent(current.disputeId)}/fast-lane`, { method: "POST", body: JSON.stringify({ action }) });
      setDHint(action === "refund"
        ? (r.ok ? `✓ refunded ${r.refundId || ""} — journalled at seq ${r.journaled?.seq}` : "✗ " + (r.error || r.note || "refund failed"))
        : "✓ entries targeted at PayPal's required slots — press Submit evidence to send");
    } catch (e: any) { setDHint("✗ " + e.message); }
  }
  async function seed() {
    setToolHint("seeding…");
    try {
      const r = await api<{ ok: boolean; detail: string }>("/api/disputes/seed-sample", { method: "POST", body: "{}" });
      setToolHint((r.ok ? "✓ " : "✗ ") + r.detail);
      await load();
    } catch (e: any) { setToolHint("✗ " + e.message); }
  }

  function statusPill(status: string) {
    const s = String(status || "").toUpperCase();
    if (s.includes("UNDER")) return `<span class="pill review">${esc(status)}</span>`;
    if (s.includes("WAITING")) return `<span class="pill open">${esc(status)}</span>`;
    if (s.includes("WON")) return `<span class="pill won">${esc(status)}</span>`;
    if (s.includes("LOST")) return `<span class="pill dead">${esc(status)}</span>`;
    return `<span class="pill mock">${esc(status)}</span>`;
  }
  const stagePill = (stage: string) => {
    const s = String(stage || "").toUpperCase();
    if (s === "INQUIRY") return '<span class="pill won">INQUIRY</span>';
    if (s === "CHARGEBACK") return '<span class="pill dead">CHARGEBACK</span>';
    if (s === "PRE_ARBITRATION") return '<span class="pill open">PRE-ARBITRATION</span>';
    return '<span class="pill mock">—</span>';
  };

  const colDefs = useMemo(() => [
    { field: "respondBy", headerName: "Deadline", pinned: "left", minWidth: 150, flex: 1.2, sort: "asc",
      valueGetter: (p: any) => { const d = daysLeft(p.data?.respondBy); return d === null ? "—" : d + " day" + (d === 1 ? "" : "s") + " left"; },
      cellRenderer: (p: any) => { const d = daysLeft(p.data?.respondBy); if (d === null) return "—";
        return <span className={d <= 3 ? "pill dead" : "pill open"}>{d}d left</span>; } },
    { field: "disputeId", headerName: "Dispute", minWidth: 140, cellRenderer: (p: any) => <span className="mono">{p.value}</span> },
    { field: "status", headerName: "Status", minWidth: 160, cellRenderer: (p: any) => <span dangerouslySetInnerHTML={{ __html: statusPill(p.value) }} /> },
    { field: "stage", headerName: "Stage", minWidth: 140, cellRenderer: (p: any) => (p.value ? <span dangerouslySetInnerHTML={{ __html: stagePill(p.value) }} /> : <span className="pill mock">—</span>) },
    { field: "reason", headerName: "Reason", minWidth: 200, valueFormatter: (p: any) => String(p.value ?? "").replaceAll("_", " ") },
    { field: "amount", headerName: "Amount", maxWidth: 130, valueFormatter: (p: any) => (p.value ?? "—") + " " + (p.data?.currency ?? "") },
    { headerName: "Linked receipt", minWidth: 150, cellRenderer: (p: any) => p.data?.linkedReceiptId
        ? <a className="mono" href={`/verify/${encodeURIComponent(p.data.linkedReceiptId)}`}>{p.data.linkedReceiptId}</a> : "—"},
    { field: "source", headerName: "Source", minWidth: 150, cellRenderer: (p: any) =>
        p.data?.paypalSample ? '<span class="pill warn" title="PayPal seeds demo cases into every sandbox merchant account - this one is not from your sales">PAYPAL SAMPLE</span>'
        : p.value === "paypal" ? '<span class="pill paypal">PAYPAL</span>' : '<span class="pill mock">MOCK</span>' },
  ], []);

  const rec = pack?.pack?.recommendation;
  const cov = pack?.pack?.coverage;
  const playbook = STAGE_PLAYBOOK[String(current?.stage || "").toUpperCase()];

  return (
    <>
      <header className="page"><h1>Resolution Center</h1></header>
      <p className="statusline">{statusline}</p>
      <p className="sub" style={{ margin: "-14px 0 14px", color: "var(--muted)", fontSize: 12.5 }}>
        Like PayPal's own Resolution Center, one list with two faces: cases <b>against your sales</b> (below)
        and the cases <b>you filed as a buyer</b> (tab) — including contestations sealed on <a href="/oversight">/oversight</a>
        {" "}before they are filed on PayPal.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2>Automation rules</h2>
          <span className="pill paypal">COVERAGE-AWARE</span>
          <span style={{ marginLeft: "auto" }}>
            <button className="ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={evaluateRules}>⚡ Evaluate now</button>
          </span>
        </div>
        <p className="sub" style={{ margin: "4px 0 10px" }}>Like PayPal's "Automatisez vos résolutions" — but the rules read the
        coverage before acting: an auto_refund rule never settles a case the signed mandate would win.</p>
        <div id="rules-list">
          {(rules ?? []).length === 0 ? <div className="empty">no rules — create one below (e.g. auto-refund ITEM_NOT_RECEIVED under €50)</div> : (rules ?? []).map((r: any) => (
            <div className="buy-row" key={r.id}>
              <span className={"pill " + (r.active ? "ok" : "mock")}>{r.active ? "ACTIVE" : "OFF"}</span>
              <b>{esc(r.name)}</b>
              <span className="muted">{(r.reasons ?? []).length ? esc(r.reasons.join(", ")) : "any reason"}</span>
              {r.maxAmount !== undefined && <span className="muted">≤ {esc(String(r.maxAmount))}</span>}
              <span className={"pill " + (r.action === "auto_refund" ? "ok" : "warn")}>{esc(r.action)}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button className="ghost" style={{ padding: "3px 10px", fontSize: 11.5 }} onClick={() => toggleRule(r.id, !r.active)}>{r.active ? "pause" : "activate"}</button>
                <button className="danger" style={{ padding: "3px 10px", fontSize: 11.5 }} onClick={() => deleteRule(r.id)}>delete</button>
              </span>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="rule name" style={{ width: 160 }} />
          <input value={ruleReasons} onChange={(e) => setRuleReasons(e.target.value)} placeholder="reasons, comma-separated (empty = any)" style={{ flex: 1, minWidth: 200 }} />
          <input value={ruleMax} onChange={(e) => setRuleMax(e.target.value)} placeholder="max amount" style={{ width: 110 }} />
          <select value={ruleAction} onChange={(e) => setRuleAction(e.target.value)} style={{ width: 140 }}>
            <option value="auto_refund">auto refund</option>
            <option value="auto_reject">flag for fight</option>
          </select>
          <button className="ghost" onClick={createRule}>Create rule</button>
        </div>
        {rulesHint && <div className="hint" style={{ marginTop: 6 }}>{rulesHint}</div>}
      </div>

      <div className="rc-tabs">
        <button className={"rc-tab" + (tab === "sales" ? " active" : "")} onClick={() => setTab("sales")}>Against my sales</button>
        <button className={"rc-tab" + (tab === "mine" ? " active" : "")} onClick={() => setTab("mine")}>
          Filed by me {mineCount > 0 && <span className="mine-count">{mineCount}</span>}
        </button>
      </div>

      {tab === "sales" ? (
        <>
          <div className="toolbar">
            <input className="input" style={{ maxWidth: 320 }} value={quick} onChange={(e) => { setQuick(e.target.value); gridApi.current?.api?.setQuickFilter?.(e.target.value); }} placeholder="Search disputes…" />
            <button className="ghost" onClick={load}>↻ Refresh</button>
            <button className="ghost" onClick={() => gridApi.current?.api?.exportDataAsCsv?.()}>⬇ CSV</button>
            <button id="viewDeadlines" onClick={() => setView(view === "grid" ? "timeline" : "grid")}>
              {view === "grid" ? "🗓 Deadlines timeline" : "↩ Back to grid"}
            </button>
            <a className="ghost" href="/board" style={{ display: "inline-flex", alignItems: "center", borderRadius: 19, padding: "8px 16px", fontSize: 13.5, background: "#fff", border: "1px solid #c8cdd6", color: "var(--text)", fontWeight: 600 }}>🗂 Dispute board</a>
            <button id="seed" onClick={seed}>Seed a SAMPLE dispute (sandbox)</button>
            <span className="hint" style={{ margin: 0 }}>{toolHint}</span>
          </div>

          {view === "grid" ? (
            <div style={{ height: 420, width: "100%" }}>
              <AgGridReact theme={gridTheme}
                onGridReady={(e) => { gridApi.current = e; }}
                columnDefs={colDefs as any}
                rowData={disputes}
                defaultColDef={{ sortable: true, filter: true, resizable: true, floatingFilter: true, flex: 1, minWidth: 90 }}
                pagination paginationPageSize={10}
                onRowClicked={(e: any) => e.data && selectDispute(e.data)} />
            </div>
          ) : (
            <div ref={calDiv} style={{ minHeight: 480, background: "#fff", border: "1px solid var(--border)", borderRadius: 10 }} />
          )}

          <div className="charts">
            <div className="chart"><h3>Disputes by status</h3><div ref={chartRefs.status} style={{ height: 200 }} /></div>
            <div className="chart"><h3>Amount by reason</h3><div ref={chartRefs.reason} style={{ height: 200 }} /></div>
          </div>

          <div className="bo-programs">
            <div className="cell">
              <h3>Frais, niveaux et programmes</h3>
              <a href="https://www.paypal.com/us/brc/article/merchant-protection" target="_blank" rel="noopener">🛡️ Protection des Marchands PayPal</a>
              <a href="https://www.paypal.com/us/cshelp/article/chargeback-protection-help502" target="_blank" rel="noopener">🏦 Outil de Protection contre les oppositions bancaires</a>
            </div>
            <div className="cell">
              <h3>Nous sommes là pour vous aider</h3>
              <a href="/docs">📖 La même API, documentée pour les agents</a>
              <a href="/verify">🔍 Vérification publique des preuves</a>
              <a href="/oversight">👁 Le point de vue de l'acheteur</a>
            </div>
          </div>
        </>
      ) : (
        <MineList />
      )}

      {current && (
        <div className="drawer show" id="drawer">
          <h2>{current.disputeId}</h2>
          <div className="kv">
            <span className="k">Status</span><span dangerouslySetInnerHTML={{ __html: statusPill(current.status) }} />
            {current.stage && <><span className="k">Stage</span><span dangerouslySetInnerHTML={{ __html: stagePill(current.stage) }} /></>}
            {playbook && <><span className="k">Playbook</span><span className="muted" style={{ fontSize: 12.5 }}>{playbook}</span></>}
            <span className="k">Reason</span><span>{esc(String(current.reason || "").replaceAll("_", " "))}</span>
            <span className="k">Amount</span><span>{esc((current.amount ?? "—") + " " + (current.currency ?? ""))}</span>
            <span className="k">Opened</span><span>{current.openedAt ? new Date(current.openedAt).toLocaleString() : "—"}</span>
            <span className="k">Respond by</span><span>{current.respondBy ? new Date(current.respondBy).toLocaleString() + ` (${daysLeft(current.respondBy) ?? "?"}d left)` : "—"}</span>
            <span className="k">Linked receipt</span>
            <span>{current.linkedReceiptId
              ? <a className="mono" href={"/verify/" + encodeURIComponent(current.linkedReceiptId)}>{esc(current.linkedReceiptId)}</a> : "—"}</span>
            <span className="k">Source</span>
            <span>
              {current.paypalSample
                ? <span className="pill warn" title="PayPal seeds demo cases into every sandbox merchant account">PAYPAL SAMPLE CASE</span>
                : current.source === "paypal" ? <span className="pill paypal">PAYPAL</span> : <span className="pill mock">MOCK</span>}
            </span>
            {current.paypalSample && (
              <span className="muted" style={{ fontSize: 11.5, gridColumn: "2" }}>
                This is one of PayPal's own sandbox demo cases (PP-R-PZT-*) — seeded into every merchant
                account for tooling tests. It is not from your sales and not from your buyer contestations.
              </span>
            )}
          </div>

          {rec && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", margin: "12px 0", background: "#fafbfd" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <b style={{ fontSize: 13.5 }}>Defense recommendation</b>
                <span className={"pill " + (rec.action === "FIGHT" ? "won" : rec.action === "REFUND_FIRST" ? "dead" : "open")}>
                  {rec.action === "FIGHT" ? "⚔ FIGHT" : rec.action === "REFUND_FIRST" ? "REFUND FIRST" : "SETTLE (either way wins)"}
                </span>
                <span style={{ flex: 1 }} />
                <span className={"pill " + (cov.covered === cov.total ? "won" : "open")} title="required evidence slots covered, per PayPal's reason → evidence matrix">
                  coverage {cov.covered}/{cov.total}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{rec.because}</div>
              <div style={{ fontSize: 12.5, marginTop: 8 }}>
                {cov.slots.map((s: any, i: number) => (
                  <div key={i} style={{ padding: "2px 0" }}>
                    <span className={"pill " + (s.status === "covered" ? "won" : "dead")}>{s.status === "covered" ? "✓" : "✗"}</span>{" "}
                    <b>{esc(s.evidenceType)}</b> — {esc(s.expects)}
                    {s.how && <span className="muted"> ({esc(s.how)})</span>}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="stop" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => fastLane("refund")}>Refund now — settle, no chargeback fee</button>
                <button className="ghost" style={{ padding: "6px 14px", fontSize: 12.5 }} onClick={() => fastLane("fight")}>Fight with the pack →</button>
                <span className="muted" style={{ fontSize: 12 }}>settle inside the INQUIRY window: no chargeback escalation, no $15–30 fee, dispute rate intact</span>
              </div>
            </div>
          )}

          <div className="tabs">
            <button className={packTab === "md" ? "active" : ""} onClick={() => setPackTab("md")}>Evidence pack (markdown)</button>
            <button className={packTab === "json" ? "active" : ""} onClick={() => setPackTab("json")}>Raw JSON</button>
            <span style={{ flex: 1 }} />
            <button className="ghost" onClick={() => current && pack && download(current.disputeId + "-evidence.md", pack.markdown, "text/markdown")}>⬇ .md</button>
            <button className="ghost" onClick={() => current && pack && download(current.disputeId + "-evidence.json", JSON.stringify(pack.pack, null, 2), "application/json")}>⬇ .json</button>
            <button onClick={submitEvidence}>Submit evidence</button>
          </div>
          {pack ? (
            packTab === "md" ? (
              <div className="md-split">
                <pre className="pack">{pack.markdown}</pre>
                <div className="pack md-body" dangerouslySetInnerHTML={{ __html: mdToHtml(pack.markdown) }} />
              </div>
            ) : (
              <pre className="pack">{JSON.stringify(pack.pack, null, 2)}</pre>
            )
          ) : (
            <pre className="pack">loading evidence pack…</pre>
          )}
          <div className="hint">{dHint}</div>
        </div>
      )}
    </>
  );
}

function MineList() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api<{ contestations: any[] }>("/api/my/contestations").then((d) => setRows(d.contestations ?? [])).catch((e) => setRows([{ error: e.message }]));
  }, []);
  if (rows === null) return <div className="empty">loading…</div>;
  if (rows.length === 0) return <div className="empty">Nothing sealed yet — open the 🛡️ Dispute panel on /oversight.</div>;
  return (
    <div>
      <p className="sub" style={{ margin: "0 0 12px" }}>
        Cases YOU opened as a buyer — sealed on /oversight the moment you contested, each carrying its signed
        evidence pack. Filing on PayPal's own site turns a seal into a live case; until then the journal is your proof.
      </p>
      {rows.map((r) => (
        <div className="mine-row" key={r.seq}>
          <span className="pill ok">SEALED · seq {r.seq}</span>
          <span className="mono">{esc(String(r.sealedAt).replace("T", " ").slice(0, 16))}</span>
          <span className="desc" title={esc(r.description || r.orderId)}>{esc(r.description || r.orderId)}</span>
          <span className="muted">{esc((r.reason || "").replaceAll("_", " ").toLowerCase())}</span>
          <span className="amt">{esc(r.amount)} {esc(r.currency)}</span>
          <a href={r.verify}>evidence →</a>
        </div>
      ))}
    </div>
  );
}

function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
