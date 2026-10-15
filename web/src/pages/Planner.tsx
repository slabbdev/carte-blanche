import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { api, esc, useScript } from "../api";

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  accentColor: "#0070e0", borderColor: "#e7e9ee", backgroundColor: "#ffffff",
  foregroundColor: "#001f33", headerTextColor: "#566173", headerBackgroundColor: "#f7f9fc",
  rowHoverColor: "#f0f6ff", fontFamily: "inherit", fontSize: 13.5,
  cellHorizontalPadding: 16, rowHeight: 48, wrapperBorderRadius: 0,
});

interface Item { id: string; title: string; merchant?: string; productId?: string; price: string; currency: string; quantity: number; status: "planned" | "receipt" | "refused"; outcomeId?: string; detail?: string }
interface Journey { id: string; name: string; currency: string; items: Item[]; mandateId?: string; recurrence?: { frequency: string }; cyclesRun?: string[]; total?: string }
interface Product { id?: string; title: string; price?: string; currency: string; image?: string; website?: string; rating?: number; offers: Array<{ price: string; currency: string; merchant?: string }> }

export default function Planner() {
  const [name, setName] = useState("team setup, this week");
  const [standing, setStanding] = useState(false);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [hint, setHint] = useState("");
  const [catQ, setCatQ] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [catSource, setCatSource] = useState("");
  const [watch, setWatch] = useState<any[]>([]);
  const [watchBusy, setWatchBusy] = useState<string | null>(null);
  const [watched, setWatched] = useState<string[]>([]);
  const cycleRef = useRef<HTMLInputElement>(null);

  // TaskBoard (Bryntum UMD via /vendor)
  const boardDiv = useRef<HTMLDivElement>(null);
  const boardRef = useRef<any>(null);
  const tbReady = useScript("/vendor/taskboard/taskboard.umd.js", () => Boolean((window as any).bryntum?.taskboard?.TaskBoard));

  const refresh = async () => {
    const list: Journey[] = await api("/api/journeys");
    setJourney(list[0] ?? null);
  };
  useEffect(() => { refresh().catch(() => {}); loadWatch().catch(() => {}); }, []);

  async function loadWatch() {
    try {
      const feed = await api<{ events: any[] }>("/api/journal/events?limit=100");
      setWatch((feed.events ?? []).filter((e) => e.type === "channel3_price_drop").slice(-6).reverse());
    } catch { setWatch([]); }
  }

  const approved = Boolean(journey?.mandateId);
  const recurring = Boolean(journey?.recurrence);

  const gridCols = useMemo(() => [
    { field: "title", headerName: "Item", minWidth: 220, flex: 2 },
    { field: "merchant", headerName: "Merchant", minWidth: 130, cellRenderer: (p: any) => (p.value ? <span className="mono">{p.value}</span> : "—") },
    { field: "price", headerName: "Unit", minWidth: 90, valueFormatter: (p: any) => (p.value ?? "—") + " " + (p.data?.currency ?? "") },
    { field: "quantity", headerName: "Qty", maxWidth: 80 },
    { headerName: "Line total", minWidth: 110, valueGetter: (p: any) => {
        if (!p.data) return "—";
        const unit = Number.parseFloat(p.data.price || "0"); const qty = Math.max(1, p.data.quantity || 1);
        return (unit * qty).toFixed(2) + " " + (p.data.currency || "");
      } },
    { field: "status", headerName: "Status", minWidth: 120, cellRenderer: (p: any) =>
        p.value === "receipt" ? <span className="pill ok">PURCHASED</span> : p.value === "refused" ? <span className="pill no">REFUSED</span> : <span className="pill mock">PLANNED</span> },
    { headerName: "Outcome", minWidth: 150, cellRenderer: (p: any) => p.data?.outcomeId
        ? <a className="mono" href={`/verify/${encodeURIComponent(p.data.outcomeId)}`}>{p.data.outcomeId}</a> : "—"},
    { field: "detail", headerName: "Detail", minWidth: 200, flex: 1, cellRenderer: (p: any) => (p.value ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.value}</span> : "") },
  ], []);

  const boardEvents = (journey?.items ?? []).map((i) => {
    const qty = Math.max(1, i.quantity || 1);
    const total = (Number.parseFloat(i.price || "0") * qty).toFixed(2) + " " + (i.currency || "USD");
    return {
      id: i.id, name: i.title,
      status: i.status === "receipt" ? "purchased" : i.status === "refused" ? "refused" : "planned",
      eventColor: i.status === "receipt" ? "green" : i.status === "refused" ? "red" : "blue",
      price: i.price, quantity: qty, total, merchant: i.merchant, productId: i.productId, outcomeId: i.outcomeId, detail: i.detail,
    };
  });

  useEffect(() => {
    if (!tbReady || !boardDiv.current || boardRef.current) return;
    const TaskBoard = (window as any).bryntum.taskboard.TaskBoard;
    boardRef.current = new TaskBoard({
      appendTo: boardDiv.current,
      columns: [{ id: "planned", text: "Planned" }, { id: "purchased", text: "Purchased" }, { id: "refused", text: "Refused" }],
      columnField: "status",
      readOnly: true,
      project: {
        eventStore: {
          data: boardEvents,
          // fields belong to the eventStore config — declaring them anywhere else
          // makes Bryntum mutate an already-generated model (getter-only throw)
          fields: ["price", "quantity", "total", "merchant", "productId", "outcomeId", "detail"],
        },
        resources: [{ id: "journey", name: "Journey lines" }],
      },
      taskRenderer: ({ taskRecord, cardConfig }: any) => {
        const t = taskRecord;
        const pill = t.status === "purchased" ? '<span class="pill ok">PURCHASED</span>'
          : t.status === "refused" ? '<span class="pill no">REFUSED</span>' : '<span class="pill mock">PLANNED</span>';
        // v7: the renderer MUTATES cardConfig — a returned string is ignored
        cardConfig.html = `
        <div class="tb-card">
        <div class="tb-title">${esc(t.name)}</div>
        <div class="tb-line"><span class="price">${esc(t.total)}</span><span class="muted">(${esc(t.price)} × ${esc(String(t.quantity))})</span></div>
        <div class="tb-merchant">${esc(t.merchant || "—")}${t.productId ? ' · <span class="mono">' + esc(t.productId) + "</span>" : ""}</div>
        <div class="tb-meta">${pill}${t.outcomeId ? '<a class="mono" href="/verify/' + encodeURIComponent(t.outcomeId) + '" target="_blank" rel="noopener">' + esc(t.outcomeId) + " →</a>" : '<span class="muted">not attempted</span>'}</div>
        ${t.detail ? '<div class="tb-detail">' + esc(t.detail) + "</div>" : ""}
        </div>`;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tbReady]);

  useEffect(() => {
    if (boardRef.current) boardRef.current.project.eventStore.data = boardEvents;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(boardEvents)]);

  async function newJourney() {
    try {
      setJourney(await api("/api/journeys", { method: "POST", body: JSON.stringify({ name, currency: "USD", items: [] }) }));
      setHint("");
    } catch (e: any) { setHint("✗ " + e.message); }
  }
  async function searchCatalog() {
    try {
      const data = await api<{ source: string; products: Product[] }>("/api/catalog?q=" + encodeURIComponent(catQ));
      setProducts(data.products ?? []);
      setCatSource(data.source === "channel3" ? '<span class="pill paypal">CHANNEL3 LIVE</span>' : '<span class="pill mock">SAMPLE DATA</span>');
    } catch (e: any) { setHint("✗ " + e.message); }
  }
  async function addLine(p: Product) {
    try {
      if (!journey) {
        setJourney(await api("/api/journeys", { method: "POST", body: JSON.stringify({
          name: name || "shopping journey", currency: "USD",
          items: [{ title: p.title, ...(p.website ? { merchant: p.website } : {}), ...(p.id ? { product_id: p.id } : {}), price: p.price }],
        }) }));
      } else {
        setJourney(await api("/api/journeys/" + encodeURIComponent(journey.id) + "/lines", { method: "POST", body: JSON.stringify({
          title: p.title, ...(p.website ? { merchant: p.website } : {}), ...(p.id ? { product_id: p.id } : {}), price: p.price, quantity: 1,
        }) }));
      }
    } catch (e: any) { setHint("✗ " + e.message); }
  }
  async function watchPrice(p: Product) {
    if (!p.id || watchBusy) return;
    setWatchBusy(p.id);
    setHint(`👁 adding price watch on ${(p.title || "").slice(0, 50)}…`);
    try {
      const r = await api<{ ok: boolean; channel3_status: number; detail?: string }>("/api/catalog/track", {
        method: "POST", body: JSON.stringify({ product_id: p.id, title: p.title }),
      });
      if (r.ok) {
        setWatched((w) => [...w, p.id!]);
        setHint(`👁 price watch LIVE on ${(p.title || "").slice(0, 50)} (channel3 ${r.channel3_status}) — drops land in the panel below. The webhook URL must be registered in the Channel3 dashboard for real drops.`);
        loadWatch().catch(() => {});
      } else {
        setHint(`✗ price watch refused (channel3 ${r.channel3_status}): ${r.detail ?? "unknown"}`);
      }
    } catch (e: any) { setHint("✗ " + e.message); }
    finally { setWatchBusy(null); }
  }
  async function approve() {
    if (!journey) return;
    try {
      setJourney(await api(`/api/journeys/${encodeURIComponent(journey.id)}/approve`, {
        method: "POST", body: JSON.stringify({ name, ...(standing ? { recurrence: "monthly", months: 12 } : {}) }),
      }));
      setHint(standing
        ? `✓ standing mandate ${journey.mandateId} signed — this basket, every month for 12 months, per-month budget = the basket.`
        : `✓ mandate ${journey.mandateId} signed from the basket — adding lines now means they run into its walls.`);
    } catch (e: any) { setHint("✗ " + e.message); }
  }
  async function run() {
    if (!journey) return;
    const cycle = cycleRef.current?.value.trim();
    setHint("running the journey through the enforcer…");
    try {
      const after = await api<Journey>(`/api/journeys/${encodeURIComponent(journey.id)}/run`, {
        method: "POST", body: JSON.stringify(cycle ? { cycle } : {}),
      });
      setJourney(after);
      const bought = after.items.filter((i) => i.status === "receipt").length;
      const refused = after.items.filter((i) => i.status === "refused").length;
      setHint(`done — ${bought} purchased, ${refused} refused (each refusal is signed proof).` + (cycle ? ` Cycle ${cycle}: retries are idempotent, next month runs fresh.` : ""));
    } catch (e: any) { setHint("✗ " + e.message); }
  }
  async function injectSample() {
    const line = (journey?.items ?? []).find((i) => i.productId);
    try {
      await api("/api/catalog/price-sample", { method: "POST", body: JSON.stringify({
        product_id: line?.productId ?? "sample-price-watch",
        old_price: line?.price ?? "24.00",
        price: line ? (Math.max(1, Number(line.price) * 0.7)).toFixed(2) : "17.00",
        currency: journey?.currency ?? "USD",
      }) });
      loadWatch().catch(() => {});
    } catch (e: any) { setHint("✗ " + e.message); }
  }
  async function reactToDrop(productId: string) {
    if (!journey?.mandateId) { setHint("approve the journey first — the re-run needs its mandate"); return; }
    const cycle = cycleRef.current?.value.trim() || new Date().toISOString().slice(0, 7);
    setHint(`price drop → re-running cycle ${cycle} under the same mandate…`);
    try {
      const after = await api<Journey>(`/api/journeys/${encodeURIComponent(journey.id)}/run`, {
        method: "POST", body: JSON.stringify({ cycle }),
      });
      setJourney(after);
      setHint("done — walls applied: same mandate, same windows.");
    } catch (e: any) { setHint("✗ " + e.message); }
  }

  return (
    <>
      <header style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1>Journey planner</h1>
        <span dangerouslySetInnerHTML={{ __html: catSource }} />
      </header>
      <p className="statusline">Plan a basket from the live catalog, approve it once — the mandate is derived and signed from the basket itself — then run it: every line meets the same walls. Tick <b>standing basket</b> and the same signature becomes a recurring authority.</p>

      <section className="card">
        <h2>1 · Source lines from the live catalog</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}><input value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder="Search the catalog… (e.g. mechanical keyboard)" style={{ borderRadius: 19 }} onKeyDown={(e) => e.key === "Enter" && searchCatalog()} /></div>
          <button className="ghost" onClick={searchCatalog}>Search</button>
          <span dangerouslySetInnerHTML={{ __html: catSource }} />
        </div>
        {products.length === 0 ? <div className="empty">search to fill this strip — then add lines to the journey</div> : (
          <div className="products">
            {products.map((p, idx) => (
              <div className="product" key={p.id ?? idx}>
                <div className="head">
                  {p.image ? <img src={p.image} alt="" referrerPolicy="no-referrer" /> : <div className="ph" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="title">{p.title}</div>
                    <div className="meta">{esc(p.website ?? "")}{p.rating ? " · ★ " + p.rating : ""}</div>
                  </div>
                </div>
                <div className="foot">
                  <span className="from">{p.price ?? "—"}</span>
                  {p.offers.length > 1 && <span className="meta">{p.offers.length} merchants</span>}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {p.id && (
                      <button type="button" className="ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                        disabled={watchBusy === p.id || watched.includes(p.id)}
                        onClick={() => watchPrice(p)}
                        title="Channel3 price tracking — a webhook lands here the moment the price moves">
                        {watched.includes(p.id) ? "👁 watched" : watchBusy === p.id ? "…" : "👁 watch"}
                      </button>
                    )}
                    <button type="button" className="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => addLine(p)}>+ add</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>2 · The journey</h2>
        <p className="sub">One basket, one signature. Approving derives the mandate from the basket itself. Tick <b>standing basket</b> and the same signature becomes a recurring authority — this basket every month for a year.</p>
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}><label>Journey name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <label style={{ alignSelf: "flex-end", display: "flex", gap: 7, alignItems: "center", padding: "0 4px 9px", fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", margin: 0 }}>
            <input type="checkbox" checked={standing} onChange={(e) => setStanding(e.target.checked)} style={{ width: 15, height: 15 }} /> standing basket — monthly × 12
          </label>
          <span style={{ alignSelf: "flex-end" }}><button className="ghost" onClick={newJourney}>New journey</button></span>
          <span style={{ alignSelf: "flex-end" }}><button className="ghost" disabled={!journey || approved || (journey?.items.length ?? 0) === 0} onClick={approve}>✓ Approve &amp; sign mandate</button></span>
          <span style={{ alignSelf: "flex-end" }}><input ref={cycleRef} placeholder="2026-10" style={{ display: recurring ? "" : "none", width: 104, textAlign: "center" }} title="Cycle key — the same basket re-runs fresh each period" /></span>
          <span style={{ alignSelf: "flex-end" }}><button disabled={!journey || !approved} onClick={run}>▶ Run journey</button></span>
        </div>

        <div style={{ height: 320, width: "100%" }}>
          <AgGridReact theme={gridTheme} columnDefs={gridCols as any} rowData={journey?.items ?? []}
            defaultColDef={{ sortable: true, resizable: true, flex: 1, minWidth: 90 }} pagination paginationPageSize={10} />
        </div>

        <div className="summary">
          <div><div className="k">Lines</div><div className="big">{journey?.items.length ?? 0}</div></div>
          <div><div className="k">Total</div><div className="big">{journey ? journey.total + " " + journey.currency : "—"}</div></div>
          <div><div className="k">Status</div>
            {!journey ? <span className="pill mock">no journey yet</span>
              : approved ? <><span className="pill ok">APPROVED</span>{recurring && <> <span className="pill paypal">⟳ MONTHLY</span></>}</>
              : <span className="pill warn">DRAFT — approve to sign</span>}
          </div>
          <div><div className="k">Mandate</div><div className="mono">{journey?.mandateId ?? "—"}</div></div>
          <div style={{ marginLeft: "auto" }}><a href="/dashboard">disputes →</a> · <a href="/verify">verify →</a></div>
        </div>
        {hint && <div className="hint" style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 10 }}>{esc(hint)}</div>}
      </section>

      <section className="card">
        <h2>3 · Price watch <span className="pill paypal" style={{ marginLeft: 6 }}>CHANNEL3 WEBHOOKS</span></h2>
        <p className="sub">Track a catalog line and Channel3 fires the moment the price moves. The drop is journalled as a trigger — the re-purchase still runs through the signed mandate walls.</p>
        {watch.length === 0 ? (
          <div className="empty">no price movement yet — watch a product above, or inject a sample drop to see the story</div>
        ) : watch.map((e: any, i: number) => {
          const d = e.data ?? {};
          const sample = String(d.source ?? "").includes("sample");
          return (
            <div className="buy-row" key={e.seq ?? i}>
              <span className={"pill " + (sample ? "mock" : "paypal")}>{sample ? "SAMPLE" : "LIVE"}</span>
              <span className="mono">{esc(String(d.product_id ?? ""))}</span>
              <span className="muted">{esc(String(d.old_price ?? "—"))} →</span>
              <span className="amt">{esc(String(d.new_price ?? ""))} {esc(String(d.currency ?? ""))}</span>
              <button className="ghost" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => reactToDrop(String(d.product_id ?? ""))}>re-run the cycle</button>
            </div>
          );
        })}
        <div style={{ marginTop: 6 }}>
          <button className="ghost" style={{ padding: "4px 12px", fontSize: 12 }} onClick={injectSample}>inject sample drop</button>
          <span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>labeled SAMPLE in the journal — the re-run still meets the signed walls</span>
        </div>
      </section>

      <section className="card">
        <h2>4 · Execution board</h2>
        <p className="sub">The same lines, as the run sees them — planned, purchased, or refused with the reason.</p>
        <div ref={boardDiv} style={{ minHeight: 320 }} />
      </section>
    </>
  );
}
