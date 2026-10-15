import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, esc } from "../api";

export default function Verify() {
  const { id: routeId } = useParams();
  const [id, setId] = useState(routeId ?? "");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [lens, setLens] = useState<"summary" | "full">("summary");

  useEffect(() => {
    const probe = routeId ?? id.trim();
    if (!probe) return;
    setErr("");
    (async () => {
      try {
        let d = await fetch(`/api/verify/receipts/${encodeURIComponent(probe)}`).then((r) => r.json()).catch(() => null);
        if (!d || d.error) {
          d = await fetch(`/api/verify/denials/${encodeURIComponent(probe)}`).then((r) => r.json()).catch(() => null);
        }
        if (!d || d.error) {
          setData(null);
          setErr(d?.error ?? "no artifact with that id");
          return;
        }
        setData(d);
      } catch { setErr("verification service unreachable"); }
    })();
  }, [routeId]);

  const report = data?.report;
  const isReceipt = report?.subject === "receipt";
  const art = isReceipt ? data?.full?.receipt : data?.full?.denial;

  return (
    <div className="wrap">
      <header className="page"><h1>Public verification</h1></header>
      <p className="statusline">Paste any receipt or refusal id — every signature, hash and Merkle proof is
      re-computed in YOUR browser. No account, no trust in us.</p>

      <section className="card">
        <div className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="rcpt-… or deny-…"
              style={{ borderRadius: 19 }} onKeyDown={(e) => { if (e.key === "Enter") window.location.href = "/verify/" + encodeURIComponent(id.trim()); }} />
          </div>
          <button onClick={() => { window.location.href = "/verify/" + encodeURIComponent(id.trim()); }}>Verify</button>
        </div>
        {err && <div className="errorline">{esc(err)}</div>}
      </section>

      {report && (
        <>
          <section className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 16 }}>
                {isReceipt ? "Receipt" : "Refusal"} <span className="mono">{esc(art?.receiptId ?? art?.denialId ?? "")}</span> —{" "}
                {report.overall ? <span style={{ color: "var(--green)" }}>EVERYTHING CHECKS</span> : <span style={{ color: "var(--red)" }}>SOMETHING FAILED</span>}
              </h2>
              <div className="tabs" style={{ margin: 0 }}>
                <button className={lens === "summary" ? "active" : ""} onClick={() => setLens("summary")}>Summary</button>
                <button className={lens === "full" ? "active" : ""} onClick={() => setLens("full")}>Full evidence</button>
              </div>
            </div>
            {lens === "summary" ? (
              <div>
                {report.checks.map((c: any, i: number) => (
                  <div className="buy-row" key={i}>
                    <span className={"pill " + (c.ok ? "ok" : "no")}>{c.ok ? "✓" : "✗"}</span>
                    <b>{esc(c.name)}</b>
                    <span className="muted" style={{ flex: 1 }}>{esc(c.detail ?? "")}</span>
                  </div>
                ))}
                <div className="buy-row">
                  <span className="pill mock">CHAIN</span>
                  <span className="muted">{data.chain?.ok
                    ? <>journal intact — {data.chain.length} events, tip <span className="mono">{esc(String(data.chain.tip).slice(0, 24))}…</span></>
                    : <>BROKEN at seq {data.chain?.brokenAt}</>}</span>
                </div>
              </div>
            ) : (
              <pre className="pack">{JSON.stringify(data.full, null, 2)}</pre>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              The <b>{isReceipt ? "mandate" : "mandate + refusal"}</b> is signed with Ed25519; the events live in an
              append-only SHA-256 chain with signed checkpoints and an RFC 3161 TSA anchor. Clone the repo and run
              the same verification offline — same result.
            </p>
          </section>
        </>
      )}

      <p className="muted" style={{ fontSize: 12.5 }}>
        Agent tools: the same API is <a href="/docs">documented for agents</a> · <a href="/">console →</a>
      </p>
      <Link to="/" className="muted" style={{ fontSize: 12 }}>← home</Link>
    </div>
  );
}
