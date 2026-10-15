export default function Docs() {
  return (
    <div className="wrap">
      <header className="page"><h1>API</h1></header>
      <p className="statusline">The contract agents consume — same endpoints as the UI, same sealed evidence.</p>

      <section className="card">
        <h2>Machine-readable</h2>
        <div className="buy-row"><span className="pill paypal">CONTRACT</span><a href="/openapi.json">/openapi.json</a><span className="muted">OpenAPI 3.0 — APIMatic-validated, TypeScript SDK generated from it (see repo sdk/typescript)</span></div>
        <div className="buy-row"><span className="pill paypal">AGENTS</span><a href="/llms.txt">/llms.txt</a><span className="muted">the API map + behavior rules for agents that read before they act</span></div>
        <div className="buy-row"><span className="pill paypal">MCP</span><span className="mono">npm run mcp</span><span className="muted">the same API as MCP tools — connect any MCP client (below)</span></div>
      </section>

      <section className="card">
        <h2>MCP server — one config, every agent</h2>
        <p className="sub">Stdio MCP server over the same API: add it to Claude Desktop, Cursor or any
        MCP client with this config — the agent then holds the mandate tools directly.</p>
        <pre className="pack" style={{ maxHeight: 180 }}>{JSON.stringify({
          mcpServers: {
            "carte-blanche": {
              command: "npm",
              args: ["run", "mcp", "--prefix", "/path/to/carte-blanche"],
              env: { CB_BASE_URL: "https://carte-blanche-6jgo.onrender.com" },
            },
          },
        }, null, 2)}</pre>
        <p className="sub" style={{ marginTop: 10 }}>
          <b>Doctrine for the agent:</b> always pass <code>intent_text</code> — the user's verbatim
          words that asked for the purchase. They are sealed into the tamper-evident journal and
          stamped on the receipt: your seller's defense against "I never told my agent to buy that".
        </p>
        <h3 style={{ margin: "10px 0 4px" }}>The 14 tools</h3>
        <div className="buy-row"><span className="mono">healthz</span><span className="muted">rails mode, journal length, catalog source</span></div>
        <div className="buy-row"><span className="mono">search_catalog</span><span className="muted">Channel3 live products, offers grouped cheapest-first</span></div>
        <div className="buy-row"><span className="mono">grant_mandate</span><span className="muted">signed spending authority — optional recurrence (standing "$X/month")</span></div>
        <div className="buy-row"><span className="mono">mandate_status</span><span className="muted">limits, window, recurrence, captured spend — call before spending</span></div>
        <div className="buy-row"><span className="mono">revoke_mandate</span><span className="muted">instant, journalled — the only way authority ends</span></div>
        <div className="buy-row"><span className="mono">purchase</span><span className="muted">THE boundary: signed receipt or signed refusal (pass intent_text)</span></div>
        <div className="buy-row"><span className="mono">my_artifacts</span><span className="muted">your receipts and refusals</span></div>
        <div className="buy-row"><span className="mono">verify_artifact</span><span className="muted">full verification report: signatures, Merkle proof, chain</span></div>
        <div className="buy-row"><span className="mono">agent_track_record</span><span className="muted">signed reputation computed from the sealed chain</span></div>
        <div className="buy-row"><span className="mono">save_preference · recall_preferences</span><span className="muted">journalled memory of the principal's tastes</span></div>
        <div className="buy-row"><span className="mono">plan_journey · approve_journey · run_journey</span><span className="muted">baskets that derive their own mandate; cycle runs; price-drop re-runs</span></div>
      </section>

      <section className="card">
        <h2>Core endpoints</h2>
        <div className="buy-row"><span className="mono">POST /api/mandates</span><span className="muted">grant a signed mandate (recurrence: {"{frequency, max_per_window}"} for a standing authority)</span></div>
        <div className="buy-row"><span className="mono">POST /api/agent/purchase</span><span className="muted">THE agent boundary — receipt or signed refusal</span></div>
        <div className="buy-row"><span className="mono">POST /api/agent/purchase/resume</span><span className="muted">complete a wallet purchase after buyer approval</span></div>
        <div className="buy-row"><span className="mono">POST /api/journeys · /approve · /run</span><span className="muted">baskets that derive their own mandate; cycle runs for recurring ones</span></div>
        <div className="buy-row"><span className="mono">GET /api/verify/:kind/:id</span><span className="muted">public verification report (receipts | denials)</span></div>
        <div className="buy-row"><span className="mono">GET /api/disputes · evidence-pack · fast-lane</span><span className="muted">the seller side: coverage, defense recommendation, settle or fight</span></div>
        <div className="buy-row"><span className="mono">POST /api/receipts/:id/dispute-request</span><span className="muted">the buyer side: seal a contestation intent</span></div>
        <div className="buy-row"><span className="mono">GET /api/journal/verify · /events · /anchor</span><span className="muted">the sealed chain, publicly verifiable</span></div>
      </section>

      <p className="muted" style={{ fontSize: 12.5 }}>
        Full reference: <a href="/openapi.json">/openapi.json</a> · agent rules: <a href="/llms.txt">/llms.txt</a> ·{" "}
        <a href="/">console →</a>
      </p>
    </div>
  );
}
