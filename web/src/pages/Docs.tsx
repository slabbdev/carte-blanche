export default function Docs() {
  return (
    <div className="wrap">
      <header className="page"><h1>API</h1></header>
      <p className="statusline">The contract agents consume — same endpoints as the UI, same sealed evidence.</p>

      <section className="card">
        <h2>Machine-readable</h2>
        <div className="buy-row"><span className="pill paypal">CONTRACT</span><a href="/openapi.json">/openapi.json</a><span className="muted">OpenAPI 3.0 — APIMatic-validated, TypeScript SDK generated from it (see repo sdk/typescript)</span></div>
        <div className="buy-row"><span className="pill paypal">AGENTS</span><a href="/llms.txt">/llms.txt</a><span className="muted">the API map + behavior rules for agents that read before they act</span></div>
        <div className="buy-row"><span className="pill paypal">MCP</span><span className="mono">npm run mcp</span><span className="muted">the same API as MCP tools (mcp/server.ts in the repo)</span></div>
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
