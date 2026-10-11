import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateKeys } from "./lib/keys.js";
import { Journal } from "./journal/journal.js";
import { MandateStore } from "./mandate/store.js";
import { newMandateId, validateMandate, type Mandate } from "./mandate/mandate.js";
import { signMandate } from "./mandate/signing.js";
import { makeRails, makePayPalClient } from "./paypal/adapter.js";
import { Enforcer } from "./enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "./receipts/receipts.js";
import { DisputeService } from "./disputes/service.js";
import { buildEvidencePack, toMarkdown, toProvideEvidenceEntries } from "./disputes/evidence.js";
import { Channel3Catalog } from "./catalog/channel3.js";

import { loadEnvFile } from "./lib/env.js";

loadEnvFile();

import { TsaClient, parseTimestampResponse, verifyTimestampToken } from "./journal/tsa.js";

const PORT = Number(process.env.PORT ?? 8790);
const KEYS_DIR = process.env.KEYS_DIR ?? ".keys";
const STATE_DIR = process.env.STATE_DIR ?? ".state";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
const repoRoot = path.join(webRoot, "..", "..");
const keys = loadOrCreateKeys(KEYS_DIR);
const journal = new Journal(path.join(STATE_DIR, "journal.jsonl"), keys.journal);
const store = new MandateStore(path.join(STATE_DIR, "mandates.json"));
const rails = makeRails(process.env);
// Third-party time anchoring is live-mode only: mock stays deterministic and offline.
const tsa = rails.mode === "live" ? new TsaClient(process.env.TSA_URLS?.split(",")) : undefined;
const enforcer = new Enforcer(journal, store, rails, keys, STATE_DIR, { tsa });
// Real-product catalog (Channel3 sponsor): without an API key it serves
// clearly-labeled sample products so the shopping scene still works offline.
const catalog = new Channel3Catalog(process.env.CHANNEL3_API_KEY);
const disputes = new DisputeService({
  railsMode: rails.mode,
  client: makePayPalClient(process.env),
  enforcer,
  journal,
});

const app = express();
app.use(express.json());
app.use(express.static(webRoot));
app.use("/vendor", express.static(path.join(repoRoot, "node_modules", "ag-grid-community", "dist")));
app.use("/vendor/charts", express.static(path.join(repoRoot, "node_modules", "ag-charts-community", "dist", "umd")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rails: rails.mode, journalLength: journal.length, catalog: catalog.enabled ? "channel3" : "sample", uptimeSec: Math.round(process.uptime()) });
});

app.get("/api/catalog", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 120);
  try {
    res.json(await catalog.search(q));
  } catch (e) {
    res.status(502).json({ error: `catalog unavailable: ${(e as Error).message}` });
  }
});

// ---------------------------------------------------------------------------
// Mandates (the human side). In this dev mode the server signs as custodial
// principal; principal-held keys are on the roadmap.
// ---------------------------------------------------------------------------

interface CreateMandateBody {
  principal?: string;
  agent?: string;
  purpose?: string;
  currency?: string;
  max_per_transaction?: string;
  max_total_spend?: string;
  payees?: string[];
  window_end?: string;
}

app.post("/api/mandates", (req, res) => {
  const body = req.body as CreateMandateBody;
  const currency = (body.currency ?? "USD").toUpperCase();
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: String(body.principal ?? "anonymous"),
    agent: String(body.agent ?? "unnamed-agent"),
    purpose: String(body.purpose ?? "unspecified"),
    limits: {
      currency,
      maxPerTransaction: String(body.max_per_transaction ?? "0.00"),
      maxTotalSpend: String(body.max_total_spend ?? "0.00"),
      payees: Array.isArray(body.payees) && body.payees.length > 0 ? body.payees.map(String) : undefined,
      windowStart: new Date().toISOString(),
      windowEnd: String(body.window_end ?? new Date(Date.now() + 7 * 24 * 3_600_000).toISOString()),
    },
    issuedAt: new Date().toISOString(),
  };
  const errors = validateMandate(mandate);
  if (errors.length > 0) return res.status(400).json({ errors });
  const signed = signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64);
  store.put(signed);
  journal.append("mandate_issued", { mandate_id: mandate.id, principal: mandate.principal, agent: mandate.agent });
  res.status(201).json(signed);
});

app.get("/api/mandates", (_req, res) => {
  res.json(
    store.list().map((s) => ({
      ...s,
      revoked: store.isRevoked(s.mandate.id),
      revocation: store.revocationOf(s.mandate.id) ?? null,
    })),
  );
});

app.get("/api/mandates/:id", (req, res) => {
  const signed = store.get(req.params.id);
  if (!signed) return res.status(404).json({ error: "mandate not found" });
  res.json({
    ...signed,
    revoked: store.isRevoked(req.params.id),
    revocation: store.revocationOf(req.params.id) ?? null,
    captured_spend: formatForApi(journal.capturedMinorFor(req.params.id), signed.mandate.limits.currency),
  });
});

app.post("/api/mandates/:id/revoke", (req, res) => {
  const reason = String((req.body as { reason?: string } | undefined)?.reason ?? "revoked by principal");
  const record = store.revoke(req.params.id, reason);
  if (!record) return res.status(404).json({ error: "mandate not found" });
  journal.append("mandate_revoked", { mandate_id: req.params.id, reason });
  res.json(record);
});

// ---------------------------------------------------------------------------
// The agent boundary: the only way an agent can move money.
// ---------------------------------------------------------------------------

app.post("/api/agent/purchase", async (req, res) => {
  const body = req.body as {
    mandate_id?: string;
    amount?: string;
    currency?: string;
    description?: string;
    payee?: string;
    logical_key?: string;
  };
  if (!body.mandate_id || !body.amount || !body.currency || !body.description) {
    return res.status(400).json({ error: "mandate_id, amount, currency and description are required" });
  }
  try {
    const outcome = await enforcer.purchase({
      mandateId: body.mandate_id,
      amount: body.amount,
      currency: body.currency.toUpperCase(),
      description: body.description,
      payee: body.payee,
      logicalKey: body.logical_key,
    });
    res.json(outcome.kind === "receipt" ? { outcome: "receipt", ...outcome.full } : { outcome: "denial", ...outcome.full });
  } catch (e) {
    res.status(502).json({ error: `rails failure: ${(e as Error).message}` });
  }
});

// ---------------------------------------------------------------------------
// Evidence: receipts, refusals, verification.
// ---------------------------------------------------------------------------

app.get("/api/receipts", (req, res) => {
  const mandateId = typeof req.query.mandate_id === "string" ? req.query.mandate_id : undefined;
  res.json({
    receipts: enforcer.listReceipts(mandateId),
    denials: enforcer.listDenials(mandateId),
  });
});

app.get("/api/receipts/:id/full", (req, res) => {
  const full = enforcer.fullReceipt(req.params.id);
  if (!full) return res.status(404).json({ error: "receipt not found" });
  res.json({ outcome: "receipt", ...full });
});

app.get("/api/denials/:id/full", (req, res) => {
  const full = enforcer.fullDenial(req.params.id);
  if (!full) return res.status(404).json({ error: "denial not found" });
  res.json({ outcome: "denial", ...full });
});

app.get("/api/verify/:kind/:id", (req, res) => {
  const { kind, id } = req.params;
  if (kind === "receipts") {
    const full = enforcer.fullReceipt(id);
    if (!full) return res.status(404).json({ error: "receipt not found" });
    return res.json({ report: verifyFullReceipt(full), chain: journal.verify(), full });
  }
  if (kind === "denials") {
    const full = enforcer.fullDenial(id);
    if (!full) return res.status(404).json({ error: "denial not found" });
    return res.json({ report: verifyFullDenial(full), chain: journal.verify(), full });
  }
  res.status(400).json({ error: "kind must be 'receipts' or 'denials'" });
});

app.get("/verify/:id", (_req, res) => {
  res.sendFile(path.join(webRoot, "verify.html"));
});

app.get("/api/journal/verify", (_req, res) => {
  res.json({ ...journal.verify(), checkpoint: journal.lastCheckpointInfo() ?? null });
});

app.get("/api/journal/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
  res.json({ events: journal.recent(limit) });
});

// Server-sent events: the cockpit's live feed. Pushes the journal position and
// the dispute list so the AG Grid can apply async transactions instead of
// re-reading whole tables.
const streamClients = new Set<express.Response>();
async function streamSnapshot(): Promise<Record<string, unknown>> {
  let rows: unknown[] = [];
  try {
    rows = await disputes.list();
  } catch {
    /* transient rails outage: stream keeps the journal side alive */
  }
  return { journal: { tip: journal.tip(), length: journal.length }, disputes: rows };
}
app.get("/api/stream", async (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  streamClients.add(res);
  const push = async () => {
    try {
      res.write(`data: ${JSON.stringify(await streamSnapshot())}\n\n`);
    } catch {
      /* client gone; close handler cleans up */
    }
  };
  await push();
  const timer = setInterval(push, 8_000);
  req.on("close", () => {
    clearInterval(timer);
    streamClients.delete(res);
  });
});

// Broadcast a tick the moment the journal moves, so live purchases land in the
// cockpit instantly instead of waiting for the next poll.
const broadcastTick = (): void => {
  for (const client of streamClients) {
    client.write(`data: ${JSON.stringify({ journal: { tip: journal.tip(), length: journal.length } })}\n\n`);
  }
};
const rawAppend = journal.append.bind(journal);
journal.append = (type: string, data: unknown) => {
  const event = rawAppend(type, data);
  broadcastTick();
  return event;
};

app.get("/api/journal/anchor", (_req, res) => {
  const anchor = journal.latestAnchor();
  if (!anchor) return res.json({ anchored: false });
  // Re-run the repo's own RFC 3161 reader against the stored token so the
  // reported status is computed, never trusted from write time.
  let tokenOk = false;
  let reasons: string[] = [];
  try {
    const info = parseTimestampResponse(Buffer.from(anchor.tokenB64, "base64"));
    const verdict = verifyTimestampToken({ imprintHex: anchor.root, nonceHex: anchor.nonce }, info);
    tokenOk = verdict.ok;
    reasons = verdict.reasons;
  } catch (e) {
    reasons = [`unreadable token: ${(e as Error).message}`];
  }
  res.json({
    anchored: true,
    anchor,
    tokenOk,
    reasons,
    chainCovers: journal.length >= anchor.size,
    openssl: [
      `curl -o anchor.tsr http://localhost:${PORT}/api/journal/anchor.tsr`,
      `curl -o anchor.tsq http://localhost:${PORT}/api/journal/anchor.tsq`,
      "curl -O https://freetsa.org/files/cacert.pem -O https://freetsa.org/files/tsa.crt",
      "openssl ts -verify -queryfile anchor.tsq -in anchor.tsr \\",
      "  -CAfile cacert.pem -untrusted tsa.crt",
    ].join("\n"),
  });
});

app.get("/api/journal/anchor.tsr", (_req, res) => {
  const anchor = journal.latestAnchor();
  if (!anchor) return res.status(404).json({ error: "journal has no anchor yet" });
  res.set("Content-Type", "application/timestamp-reply");
  res.send(Buffer.from(anchor.tokenB64, "base64"));
});

app.get("/api/journal/anchor.tsq", (_req, res) => {
  const anchor = journal.latestAnchor();
  if (!anchor?.requestB64) return res.status(404).json({ error: "journal has no anchored request yet" });
  res.set("Content-Type", "application/timestamp-query");
  res.send(Buffer.from(anchor.requestB64, "base64"));
});

// ---------------------------------------------------------------------------
// Merchant dispute cockpit.
// ---------------------------------------------------------------------------

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(webRoot, "dashboard.html"));
});

app.get("/api/disputes", async (_req, res) => {
  try {
    res.json({ source: disputes.source, disputes: await disputes.list() });
  } catch (e) {
    res.status(502).json({ error: `disputes unavailable: ${(e as Error).message}` });
  }
});

app.get("/api/disputes/:id", async (req, res) => {
  const d = await disputes.get(req.params.id).catch(() => undefined);
  if (!d) return res.status(404).json({ error: "dispute not found" });
  res.json(d);
});

app.get("/api/disputes/:id/evidence-pack", async (req, res) => {
  const d = await disputes.get(req.params.id).catch(() => undefined);
  if (!d) return res.status(404).json({ error: "dispute not found" });
  const pack = buildEvidencePack(d, { enforcer, journal, store, keys });
  res.json({ pack, markdown: toMarkdown(pack) });
});

app.post("/api/disputes/:id/submit-evidence", async (req, res) => {
  const d = await disputes.get(req.params.id).catch(() => undefined);
  if (!d) return res.status(404).json({ error: "dispute not found" });
  const pack = buildEvidencePack(d, { enforcer, journal, store, keys });
  const result = await disputes.submitEvidence(d.disputeId, toProvideEvidenceEntries(pack), toMarkdown(pack));
  journal.append("evidence_submitted", {
    dispute_id: d.disputeId,
    pack_id: pack.packId,
    ok: result.ok,
    detail: result.detail.slice(0, 200),
  });
  res.json(result);
});

app.post("/api/disputes/seed-sample", async (req, res) => {
  const body = (req.body ?? {}) as { transaction_id?: string; reason?: string };
  const firstReceipt = enforcer.listReceipts()[0];
  const transactionId = String(body.transaction_id ?? firstReceipt?.orderId ?? "");
  if (!transactionId) {
    return res.status(400).json({ error: "no transaction id (make a purchase first or pass transaction_id)" });
  }
  const result = await disputes.createSample({
    transactionId,
    reason: String(body.reason ?? "ITEM_NOT_RECEIVED"),
  });
  res.json(result);
});

function formatForApi(minor: bigint, currency: string): string {
  const exp = currency === "JPY" ? 0 : 2;
  if (exp === 0) return minor.toString();
  const s = minor.toString().padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

app.listen(PORT, () => {
  console.log(`carte-blanche listening on http://localhost:${PORT} (rails: ${rails.mode})`);
});
