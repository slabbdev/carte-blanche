import { useEffect, useState } from "react";
import { api, esc } from "../api";

interface Mandate { mandate: { id: string; principal: string; agent: string; purpose: string; limits: any }; revoked: boolean }
interface Receipt { receiptId: string; mandateId: string; createdAt: string; description: string; amount: string; currency: string; orderId: string }

export default function Oversight() {
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [prefs, setPrefs] = useState<{ preferences: Record<string, string>; notes: string[] }>({ preferences: {}, notes: [] });
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [feed, setFeed] = useState<any[]>([]);
  const [watch, setWatch] = useState<any[] | null>(null);
  const [watchErr, setWatchErr] = useState("");
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Record<string, { seq: number; verify: string }>>({});

  const load = async () => {
    const [ms, pf, rc] = await Promise.all([
      api<Mandate[]>("/api/mandates"),
      api<any>("/api/agent/preferences").catch(() => ({ preferences: {}, notes: [] })),
      api<{ receipts: Receipt[] }>("/api/receipts").catch(() => ({ receipts: [] })),
    ]);
    setMandates(ms);
    setPrefs(pf);
    setReceipts(rc.receipts ?? []);
    const f = await api<{ events: any[] }>("/api/journal/events?limit=25");
    setFeed(f.events ?? []);
    try {
      const d = await api<{ disputes: any[] }>("/api/disputes");
      setWatch(d.disputes ?? []);
    } catch (e: any) { setWatchErr(e.message); }
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const byAgent = new Map<string, Mandate[]>();
  for (const m of mandates) {
    const a = m.mandate.agent;
    if (!byAgent.has(a)) byAgent.set(a, []);
    byAgent.get(a)!.push(m);
  }
  const receiptsByMandate = new Map<string, Receipt[]>();
  for (const r of receipts) {
    if (!receiptsByMandate.has(r.mandateId)) receiptsByMandate.set(r.mandateId, []);
    receiptsByMandate.get(r.mandateId)!.push(r);
  }

  async function stopAgent(mandateId: string) {
    if (!confirm("STOP this mandate? The agent loses ALL authority under it, immediately and irreversibly (revocation is journalled).")) return;
    await api(`/api/mandates/${encodeURIComponent(mandateId)}/revoke`, {
      method: "POST", body: JSON.stringify({ reason: "stopped by principal from oversight" }),
    });
    load().catch(() => {});
  }

  async function fileDispute(receiptId: string, reason: string, note: string) {
    const out = await api<any>(`/api/receipts/${encodeURIComponent(receiptId)}/dispute-request`, {
      method: "POST", body: JSON.stringify({ reason, note }),
    });
    setSealed((s) => ({ ...s, [receiptId]: { seq: out.journaled.seq, verify: out.verify } }));
    setOpenPanel(null);
    load().catch(() => {});
  }

  const cards = [...byAgent.entries()].map(([agentName, list]) => {
    const buys = list.flatMap((m) => receiptsByMandate.get(m.mandate.id) ?? [])
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);
    return (
      <div className="agent" key={agentName}>
        <h3>{esc(agentName)}</h3>
        <div className="stats">
          <div className="stat"><div className="k">Mandates</div><div className="v">{list.length}</div></div>
        </div>
        {list.map((m) => (
          <div className="mandate-row" key={m.mandate.id}>
            <span className="mono">{esc(m.mandate.id)}</span>
            {m.revoked ? <span className="pill no">REVOKED</span> : <span className="pill ok">ACTIVE</span>}
            <span className="muted">{esc(m.mandate.purpose)}</span>
            <span>max {esc(m.mandate.limits.maxPerTransaction)} {esc(m.mandate.limits.currency)} / tx · total {esc(m.mandate.limits.maxTotalSpend)}</span>
            <span style={{ marginLeft: "auto" }}>
              {!m.revoked && <button className="stop" onClick={() => stopAgent(m.mandate.id)}>✕ STOP</button>}
            </span>
          </div>
        ))}
        {buys.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", margin: "14px 0 2px" }}>
              My purchases — each one carries its signed evidence pack
            </div>
            {buys.map((r) => {
              const s = sealed[r.receiptId];
              return (
                <div key={r.receiptId}>
                  <div className="buy-row">
                    <span className="mono">{esc(r.createdAt.replace("T", " ").slice(0, 16))}</span>
                    <span className="desc" title={esc(r.description)}>{esc(r.description)}</span>
                    <span className="amt">{esc(r.amount)} {esc(r.currency)}</span>
                    <a href={`/verify/${esc(r.receiptId)}`}>evidence →</a>
                    <span>
                      {s ? (
                        <a className="pill ok" style={{ textDecoration: "none" }} href={s.verify} title={"sealed at seq " + s.seq}>
                          SEALED #{s.seq}
                        </a>
                      ) : (
                        <button className="stop" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setOpenPanel(openPanel === r.receiptId ? null : r.receiptId)}>🛡️ Dispute</button>
                      )}
                    </span>
                  </div>
                  {openPanel === r.receiptId && (
                    <DisputePanel receiptId={r.receiptId} onFile={(reason, note) => fileDispute(r.receiptId, reason, note)} />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  });

  return (
    <>
      <header><h1>My agents</h1></header>
      <p className="statusline">
        The buyer's view: what your agents spent, what they remember about you, which walls held — and the
        switch that ends their authority instantly. Disagree with a purchase? One click seals your
        contestation with its signed evidence pack. Like PayPal's Resolution Center, your cases live in the
        same list as the ones against your sales — see the <a href="/dashboard">Resolution Center</a>.
      </p>
      <div id="agents">
        {cards.length ? cards : <div className="empty">No agents yet — grant a mandate in the <a href="/">console</a>.</div>}
      </div>

      <section className="card">
        <h2>Dispute watch — PayPal's side</h2>
        <p className="sub">What PayPal sees on these orders right now. When a dispute opens, your sealed contestation and the agent's signed receipts are already waiting in your evidence packs.</p>
        {watch === null ? <div className="empty">loading…</div>
          : watchErr ? <div className="empty">dispute feed unavailable: {esc(watchErr)}</div>
          : watch.length ? watch.map((x: any) => (
              <div className="buy-row" key={x.disputeId ?? x.id}>
                <span className="mono">{esc(x.disputeId ?? x.id ?? "")}</span>
                <span className={"pill " + (String(x.status ?? "").includes("RESOLVED") ? "ok" : "warn")}>{esc(x.status ?? "?")}</span>
                <span className="muted">{esc(x.reason ?? "")}</span>
                {x.respondBy && <span className="muted">respond by <b>{esc(String(x.respondBy).replace("T", " ").slice(0, 16))}</b></span>}
              </div>
            )) : <div className="empty">No disputes on PayPal's side right now.</div>}
      </section>

      <section className="card">
        <h2>Recent activity (sealed journal)</h2>
        <p className="sub">Every event your agents caused — hashes chained, tamper-evident, publicly verifiable.</p>
        <div className="feed">
          {feed.slice().reverse().map((e) => (
            <div key={e.seq}>
              <span className="t">{esc(String(e.ts).replace("T", " ").slice(0, 19))}</span>
              <b>{esc(e.type)}</b> <span className="mono">{esc(JSON.stringify(e.data).slice(0, 110))}…</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Verify any artifact at <a href="/verify">/verify</a> — no account needed.
        </p>
      </section>
    </>
  );
}

function DisputePanel({ receiptId, onFile }: { receiptId: string; onFile: (reason: string, note: string) => Promise<void> }) {
  const [reason, setReason] = useState("ITEM_NOT_RECEIVED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="dispute-panel open">
      <b>You keep the proof:</b> sealing here journals YOUR contestation (reason, receipt, order id) with its
      evidence pack. The PayPal dispute itself is filed on PayPal's own site — the SELLER's cockpit picks the
      case up when PayPal emits it. Two seats, one story.
      <select value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="ITEM_NOT_RECEIVED">item not received</option>
        <option value="ITEM_NOT_AS_DESCRIBED">not as described</option>
        <option value="OTHER">other</option>
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" style={{ flex: 1, minWidth: 140 }} />
      <button style={{ padding: "5px 14px", fontSize: 12.5 }} disabled={busy}
        onClick={async () => { setBusy(true); try { await onFile(reason, note); } finally { setBusy(false); } }}>
        Seal my contestation
      </button>
    </div>
  );
}
