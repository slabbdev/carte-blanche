import { useEffect, useRef, useState } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { api, esc } from "../api";
import { myKeyFingerprints, sha256Hex, signMandateInBrowser } from "../lib/noncustodial";

interface Product {
  id?: string; title: string; price?: string; currency: string; image?: string;
  website?: string; rating?: number; offers: Array<{ price: string; currency: string; merchant?: string; buyUrl?: string }>;
}
interface Mandate { mandate: { id: string; principal: string; agent: string; purpose: string; limits: any }; revoked: boolean; publicKey: string }

export default function Console() {
  const [railsPill, setRailsPill] = useState("");
  const [statusline, setStatusline] = useState("connecting…");
  const [journal, setJournal] = useState("checking journal…");

  // grant form
  const [principal, setPrincipal] = useState("sam");
  const [agent, setAgent] = useState("shopping-agent-1");
  const [purpose, setPurpose] = useState("team gear this week");
  const [currency, setCurrency] = useState("USD");
  const [maxTx, setMaxTx] = useState("79.00");
  const [maxTotal, setMaxTotal] = useState("120.00");
  const [windowEnd, setWindowEnd] = useState("");
  const [payees, setPayees] = useState("");
  const [selfSign, setSelfSign] = useState(false);
  const [selfNote, setSelfNote] = useState("");

  // shop
  const [query, setQuery] = useState("");
  const [catSource, setCatSource] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [openOffers, setOpenOffers] = useState<number | null>(null);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [selMandate, setSelMandate] = useState("");
  const [amount, setAmount] = useState("59.99");
  const [desc, setDesc] = useState("mechanical keyboard (65%, hot-swap)");
  const [payee, setPayee] = useState("");
  const [funding, setFunding] = useState<"card" | "wallet">("card");
  const [outcome, setOutcome] = useState("");
  const [apGoal, setApGoal] = useState("");
  const [apMode, setApMode] = useState("");
  const [apOut, setApOut] = useState("");
  const [outcomes, setOutcomes] = useState<Array<{ t: string; o: any }>>([]);
  const [trAgent, setTrAgent] = useState("shopping-agent-1");
  const [trOut, setTrOut] = useState("");
  const [clientId, setClientId] = useState("");
  const grantRef = useRef<HTMLDivElement>(null);
  const noMandate = !selMandate;
  const goGrant = () => {
    grantRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOutcome('<span class="pill warn">PICK A MANDATE FIRST</span> — the agent can\'t spend without one. Fill <b>Grant a mandate</b> above, then come back.');
  };
  const [walletPending, setWalletPending] = useState<{ logicalKey: string; orderId: string } | null>(null);
  const myKeys = useRef<string[]>(myKeyFingerprints());

  useEffect(() => {
    const d = new Date(Date.now() + 7 * 864e5);
    setWindowEnd(new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16));
    api("/healthz").then((h: any) => {
      setRailsPill(h.rails === "mock" ? '<span class="pill mock">MOCK RAILS</span>' : '<span class="pill paypal">PAYPAL SANDBOX</span>');
      setStatusline(`rails ${h.rails} · journal sealed at ${h.journalLength} event(s) · catalog ${h.catalog === "channel3" ? "Channel3 live" : "sample data"}`);
    }).catch(() => setStatusline("server unreachable"));
    api("/api/journal/verify").then((v: any) => {
      setJournal(v.ok
        ? `Sealed journal: chain <b style="color:var(--green)">intact</b> — ${v.length} events, tip <span class="mono">${esc(v.tip.slice(0, 24))}…</span> · <a href="/docs">verify independently →</a>`
        : `Sealed journal: <b style="color:var(--red)">BROKEN at seq ${v.brokenAt}</b>`);
    }).catch(() => setJournal("journal unavailable"));
    api<{ clientId: string }>("/api/config").then((c) => setClientId(c.clientId)).catch(() => {});
  }, []);

  async function refreshMandates() {
    const list: Mandate[] = await api("/api/mandates");
    setMandates(list);
    setSelMandate((prev) => (list.some((m) => m.mandate.id === prev) ? prev : (list[0]?.mandate.id ?? "")));
  }
  async function refreshOutcomes() {
    const data = await api<{ receipts: any[]; denials: any[] }>("/api/receipts");
    setOutcomes([
      ...data.receipts.map((r) => ({ t: "receipt", o: r })),
      ...data.denials.map((d) => ({ t: "denial", o: d })),
    ].sort((a, b) => (a.o.createdAt < b.o.createdAt ? 1 : -1)));
  }
  useEffect(() => { refreshMandates().catch(() => {}); refreshOutcomes().catch(() => {}); }, []);

  async function grant() {
    try {
      const payeeList = payees.split(",").map((s) => s.trim()).filter(Boolean);
      let body: unknown;
      if (selfSign) {
        const mandate = {
          id: "cbmd-" + crypto.randomUUID(),
          version: "cb-mandate/v1",
          principal: principal || "anonymous",
          agent: agent || "unnamed-agent",
          purpose: purpose || "unspecified",
          limits: {
            currency, maxPerTransaction: maxTx, maxTotalSpend: maxTotal,
            ...(payeeList.length ? { payees: payeeList } : {}),
            windowStart: new Date().toISOString(),
            windowEnd: new Date(windowEnd).toISOString(),
          },
          issuedAt: new Date().toISOString(),
        };
        const signed = await signMandateInBrowser(mandate);
        myKeys.current = myKeyFingerprints();
        body = { mandate: signed.mandate, signature: signed.signature, publicKey: signed.publicKey };
        setSelfNote(`✓ mandate <span class="mono">${esc(mandate.id)}</span> signed by <b>your</b> browser key <span class="mono">${esc(signed.fingerprint)}</span> — the server verified it and cannot forge it.`);
      } else {
        body = {
          principal, agent, purpose, currency,
          max_per_transaction: maxTx, max_total_spend: maxTotal,
          payees: payeeList, window_end: new Date(windowEnd).toISOString(),
        };
      }
      await api("/api/mandates", { method: "POST", body: JSON.stringify(body) });
      if (!selfSign) setSelfNote("");
      await refreshMandates();
    } catch (e: any) { alert(e.message); }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this mandate? Agents are refused immediately after.")) return;
    await api(`/api/mandates/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason: "revoked from console" }) });
    await refreshMandates();
  }

  const searchSeq = useRef(0);
  async function search() {
    const q = query.trim();
    if (q.length < 2) { setProducts([]); setCatSource('<span class="pill mock">type at least 2 characters</span>'); return; }
    const seq = ++searchSeq.current;
    setCatSource('<span class="pill mock">searching…</span>');
    try {
      const data = await api<{ source: string; products: Product[] }>("/api/catalog?q=" + encodeURIComponent(q));
      if (seq !== searchSeq.current) return;
      setCatSource(data.source === "channel3" ? '<span class="pill paypal">CHANNEL3 LIVE</span>' : '<span class="pill mock">SAMPLE DATA</span>');
      setProducts(data.products);
      setOpenOffers(null);
    } catch (e: any) {
      if (seq === searchSeq.current) { setProducts([]); setCatSource('<span class="pill no">search failed</span>'); }
    }
  }
  // live search: typing drives the query (debounced)
  useEffect(() => {
    const t = setTimeout(() => { if (query.trim().length >= 2) search(); }, 550);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function selectOffer(p: Product, oi: number) {
    const o = p.offers[oi];
    setAmount(o.price);
    setDesc(p.title.replace(/^Sample: /, ""));
    if (o.merchant) setPayee(o.merchant);
    setSelMandate((m) => m);
  }

  async function attemptPurchase() {
    if (noMandate) { goGrant(); return; }
    setOutcome('<span class="muted">attempting…</span>');
    try {
      const out = await api<any>("/api/agent/purchase", {
        method: "POST",
        body: JSON.stringify({ mandate_id: selMandate, amount, currency: "USD", description: desc, ...(payee ? { payee } : {}), funding }),
      });
      if (out.kind === "receipt") {
        setOutcome(`<span class="pill ok">RECEIPT</span> <span class="mono">${esc(out.receipt.receiptId)}</span> — order ${esc(out.receipt.orderId)} · <a href="/verify/${esc(out.receipt.receiptId)}">verify →</a>`);
      } else if (out.kind === "denial") {
        setOutcome(`<span class="pill no">REFUSED</span> [${esc(out.denial.reasonCode)}] ${esc(out.denial.reasonDetail)} — <a href="/verify/${esc(out.denial.denialId)}">signed proof →</a>`);
      } else {
        setOutcome('<span class="pill warn">PENDING</span> approve in the PayPal popup below.');
      }
      await refreshOutcomes();
    } catch (e: any) { setOutcome("✗ " + esc(e.message)); }
  }

  async function runAutopilot() {
    if (noMandate) { goGrant(); return; }
    if (!apGoal.trim()) {
      setOutcome('<span class="pill warn">GIVE THE AGENT A GOAL</span> — what should it shop for? (e.g. mechanical keyboard)');
      return;
    }
    setApMode('<span class="pill mock">running…</span>');
    setApOut("");
    try {
      const avail = await api<{ llm: boolean }>("/api/agent/autopilot");
      setApMode(avail.llm ? '<span class="pill paypal">LLM POLICY</span>' : '<span class="pill mock">SCRIPTED POLICY</span>');
      const r = await api<any>("/api/agent/autopilot", { method: "POST", body: JSON.stringify({ mandate_id: selMandate, goal: apGoal || desc }) });
      setApOut(`<div class="card-item"><b>steps</b><div class="mono">${esc((r.transcript ?? []).map((s: any) => s.summary ?? s.action ?? "").join(" · "))}</div></div>`);
      await refreshOutcomes();
    } catch (e: any) { setApMode(""); setApOut("✗ " + esc(e.message)); }
  }

  async function fetchTrackRecord() {
    setTrOut("loading…");
    try {
      const tr = await api<any>("/api/agents/" + encodeURIComponent(trAgent) + "/track-record");
      setTrOut(`<div class="card-item">
        <div class="mono">signed statement · chain tip ${esc(String(tr.chainTip ?? "").slice(0, 24))}…</div>
        <div>purchases captured: <b>${tr.purchasesCaptured ?? 0}</b> · spend: ${(tr.captured ?? []).map((c: any) => `<b>${esc(c.amount)} ${esc(c.currency)}</b>`).join(" + ") || "—"}</div>
        <div>walls that held: ${(tr.refusals ?? []).map((r: any) => `<span class="pill warn">${esc(r.code)} × ${r.count}</span>`).join(" ") || '<span class="pill mock">none</span>'}</div>
      </div>`);
    } catch (e: any) { setTrOut("✗ " + esc(e.message)); }
  }

  const mine = (m: Mandate) => {
    // fingerprint match happens async; keep it simple — show YOUR KEY for client-signed mandates via session cache
    return false;
  };

  return (
    <>
      <header className="page">
        <h1>Agent spending</h1>
        <span dangerouslySetInnerHTML={{ __html: railsPill }} />
      </header>
      <p className="statusline">{statusline}</p>

      <section className="card" ref={grantRef}>
        <h2>Grant a mandate</h2>
        <p className="sub">The human signs the parsed intent: merchant allowlist, max price, total budget. Ed25519 at creation; immutable afterwards — revocation is the only exit.</p>
        <div className="grid2">
          <div><label>Principal (you)</label><input value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
          <div><label>Agent</label><input value={agent} onChange={(e) => setAgent(e.target.value)} /></div>
          <div><label>Purpose</label><input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
          <div><label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select>
          </div>
          <div><label>Max / transaction</label><input value={maxTx} onChange={(e) => setMaxTx(e.target.value)} /></div>
          <div><label>Max total</label><input value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} /></div>
          <div><label>Valid until</label><input type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} /></div>
          <div><label>Payee allowlist (comma-separated, empty = any)</label><input value={payees} onChange={(e) => setPayees(e.target.value)} placeholder="merch@keymagic.example" /></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={grant}>Grant mandate</button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
            <input type="checkbox" checked={selfSign} onChange={(e) => { setSelfSign(e.target.checked); if (!e.target.checked) setSelfNote(""); }} style={{ width: "auto", accentColor: "var(--blue)" }} />
            I keep the keys — sign in this browser (non-custodial)
          </label>
          <span className="muted" style={{ fontSize: 12 }}>What gets signed is the parse, not the prose — the Amex pattern, open-sourced.</span>
        </div>
        {selfSign && (
          <div className="hint" style={{ color: "var(--green)", marginTop: 8 }}>
            Non-custodial: an Ed25519 keypair is generated IN THIS TAB. The mandate is signed locally; the server verifies
            your signature and stores the public key — it never sees your private key and cannot forge the mandate.
          </div>
        )}
        {selfNote && <div className="hint" style={{ color: "var(--green)", marginTop: 8 }} dangerouslySetInnerHTML={{ __html: selfNote }} />}
      </section>

      <section className="card">
        <h2>Shop as the agent</h2>
        <p className="sub">Real product search across 100M+ retail offers (Channel3). Compare merchant offers — the cheaper unfamiliar one is exactly how an agent drifts; watch the mandate stop it.</p>
        {mandates.length === 0 && (
          <div className="hint" style={{ background: "#fdf3d8", border: "1px solid #f0e0b0", borderRadius: 8, padding: "8px 12px", marginBottom: 12, color: "var(--amber)" }}>
            <b>No mandates yet</b> — the agent can't spend without one. Fill <b>Grant a mandate</b> above (15 seconds, defaults are fine).
          </div>
        )}
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the catalog… (e.g. mechanical keyboard)" style={{ borderRadius: 19 }} onKeyDown={(e) => e.key === "Enter" && search()} /></div>
          <button className="ghost" onClick={search}>Search</button>
          <span dangerouslySetInnerHTML={{ __html: catSource }} />
        </div>
        {products.length === 0 ? (
          <div className="empty">search the catalog to fill the shopping scene</div>
        ) : (
          <div className="products">
            {products.map((p, idx) => (
              <div className="product" key={p.id ?? idx}>
                <div className="head">
                  {p.image ? <img src={p.image} alt="" referrerPolicy="no-referrer" /> : <div className="ph" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="title">{p.title}</div>
                    <div className="meta">{esc(p.website ?? p.offers[0]?.merchant ?? "")}{p.rating ? " · ★ " + p.rating : ""}</div>
                  </div>
                </div>
                <div className="foot">
                  <span className="from">{p.price ?? "—"} {p.currency}</span>
                  {p.offers.length > 1 && (
                    <button type="button" className="offers-toggle" onClick={() => setOpenOffers(openOffers === idx ? null : idx)}>
                      {p.offers.length} merchants ▾
                    </button>
                  )}
                  <span style={{ marginLeft: "auto" }}>
                    <button type="button" className="use-offer" onClick={() => selectOffer(p, 0)}>{p.offers.length > 1 ? "Use cheapest" : "Select"}</button>
                  </span>
                </div>
                {p.offers.length > 1 && openOffers === idx && (
                  <div className="offers show">
                    {p.offers.map((o, oi) => (
                      <div className="offer" key={oi}>
                        <span className="merchant">{esc(o.merchant ?? "unknown merchant")}</span>
                        {oi === 0 && <span className="pill ok">cheapest</span>}
                        <span className="price">{o.price} {o.currency}</span>
                        <button type="button" className="ghost" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => selectOffer(p, oi)}>use</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <div style={{ minWidth: 230 }}><label>Mandate</label>
            <select value={selMandate} onChange={(e) => setSelMandate(e.target.value)}>
              <option value="">—</option>
              {mandates.map((m) => <option key={m.mandate.id} value={m.mandate.id}>{m.mandate.id}</option>)}
            </select>
          </div>
          <div style={{ width: 110 }}><label>Amount</label><input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div style={{ flex: 1, minWidth: 200 }}><label>What for</label><input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div style={{ width: 180 }}><label>Payee (optional)</label><input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="leave empty" /></div>
          <div style={{ width: 200 }}><label>Funding</label>
            <select value={funding} onChange={(e) => setFunding(e.target.value as "card" | "wallet")}>
              <option value="card">card — auto-capture</option>
              <option value="wallet">wallet — human approves</option>
            </select>
          </div>
          <button onClick={attemptPurchase} disabled={noMandate} title={noMandate ? "pick or grant a mandate first" : ""}>Attempt purchase</button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <input value={apGoal} onChange={(e) => setApGoal(e.target.value)} placeholder="Autopilot goal… (e.g. mechanical keyboard)" style={{ flex: 1, minWidth: 200, borderRadius: 19 }} />
          <button className="ghost" onClick={runAutopilot} disabled={noMandate || !apGoal.trim()} title={noMandate ? "pick or grant a mandate first" : "type a goal for the agent"}>🤖 Autopilot</button>
          <span dangerouslySetInnerHTML={{ __html: apMode }} />
        </div>
        {outcome && <div className="outcome" dangerouslySetInnerHTML={{ __html: outcome }} />}

        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Real PayPal Buttons (official <span className="mono">@paypal/react-paypal-js</span>) for the wallet flow — the buyer approves IN PayPal; the capture comes back through the enforcer.
          </div>
          {clientId ? (
            <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture" }}>
              <div className="pp-zone">
              <PayPalButtons
                style={{ layout: "horizontal", label: "paypal" }}
                disabled={!selMandate}
                createOrder={async () => {
                  const out = await api<any>("/api/agent/purchase", {
                    method: "POST",
                    body: JSON.stringify({ mandate_id: selMandate, amount, currency: "USD", description: desc, ...(payee ? { payee } : {}), funding: "wallet" }),
                  });
                  if (out.kind !== "pending") throw new Error("the enforcer did not open an order: " + (out.kind ?? "?"));
                  setWalletPending({ logicalKey: out.logicalKey, orderId: out.orderId });
                  return out.orderId;
                }}
                onApprove={async () => {
                  if (!walletPending) return;
                  const out = await api<any>("/api/agent/purchase/resume", { method: "POST", body: JSON.stringify({ logicalKey: walletPending.logicalKey }) });
                  if (out.kind === "receipt") {
                    setOutcome(`<span class="pill ok">RECEIPT</span> <span class="mono">${esc(out.receipt.receiptId)}</span> — buyer-approved IN PayPal, captured through the enforcer · <a href="/verify/${esc(out.receipt.receiptId)}">verify →</a>`);
                    await refreshOutcomes();
                  }
                }}
                onError={(err) => setOutcome("✗ PayPal: " + esc(String(err)))}
              />
              </div>
            </PayPalScriptProvider>
          ) : (
            <div className="empty">loading PayPal SDK config…</div>
          )}
        </div>
        {apOut && <div className="outcome" dangerouslySetInnerHTML={{ __html: apOut }} />}
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          <b>Attempt purchase</b> is exactly the <code>purchase()</code> tool an LLM agent gets;
          <b> 🤖 Autopilot</b> runs the whole agent server-side under the same mandate (LLM when a key is
          configured, deterministic policy otherwise) — transcript and artifacts sealed either way.
        </p>
      </section>

      <section className="card">
        <h2>Mandates</h2>
        {mandates.length === 0 ? <div className="empty">none yet</div> : mandates.map((m) => (
          <div className="card-item" key={m.mandate.id}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono">{m.mandate.id}</span>
              {m.revoked ? <span className="pill no">REVOKED</span> : <span className="pill ok">ACTIVE</span>}
              <span style={{ marginLeft: "auto" }}>
                {!m.revoked && <button className="danger" onClick={() => revoke(m.mandate.id)}>Revoke</button>}
              </span>
            </div>
            <div className="mono" style={{ marginTop: 4 }}>{esc(m.mandate.principal)} → {esc(m.mandate.agent)} · {esc(m.mandate.purpose)}</div>
            <div className="mono">max {esc(m.mandate.limits.maxPerTransaction)} {esc(m.mandate.limits.currency)} / tx · total {esc(m.mandate.limits.maxTotalSpend)} · until {esc(String(m.mandate.limits.windowEnd).slice(0, 16))}</div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Receipts &amp; refusals</h2>
        {outcomes.length === 0 ? <div className="empty">nothing yet</div> : outcomes.map(({ t, o }) => (
          <div className="card-item" key={o.receiptId ?? o.denialId}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {t === "receipt" ? <span className="pill ok">RECEIPT</span> : <span className="pill no">REFUSED</span>}
              <span className="mono">{t === "receipt" ? o.receiptId : o.denialId}</span>
              <span className="muted" style={{ fontSize: 12 }}>{String(o.createdAt).replace("T", " ").slice(0, 19)}</span>
              <span style={{ marginLeft: "auto" }}>
                <a href={`/verify/${t === "receipt" ? o.receiptId : o.denialId}`}>verify →</a>
              </span>
            </div>
            <div className="mono" style={{ marginTop: 4 }}>
              {t === "receipt"
                ? `${esc(o.amount)} ${esc(o.currency)} · ${esc(o.description)} · order ${esc(o.orderId)} · capture ${esc(o.captureId)}`
                : `${esc(o.requested.amount)} ${esc(o.requested.currency)} · ${esc(o.requested.description)} · [${esc(o.reasonCode)}] ${esc(o.reasonDetail)}`}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Agent track record</h2>
        <p className="sub">What an agent DID, computed from the sealed chain and signed — portable, third-party verifiable. A refusal here is not a failure: each one is a wall that held. This is the raw material of agent reputation on these rails.</p>
        <div className="row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <input value={trAgent} onChange={(e) => setTrAgent(e.target.value)} placeholder="agent name (e.g. shopping-agent-1)" style={{ borderRadius: 19 }} />
          </div>
          <button className="ghost" onClick={fetchTrackRecord}>Fetch track record</button>
        </div>
        <div style={{ marginTop: 12 }} dangerouslySetInnerHTML={{ __html: trOut }} />
      </section>

      <p className="journalstrip" dangerouslySetInnerHTML={{ __html: journal }} />
    </>
  );
}
