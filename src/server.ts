import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateKeys } from "./lib/keys.js";
import { Journal } from "./journal/journal.js";
import { MandateStore } from "./mandate/store.js";
import { newMandateId, validateMandate, type Mandate } from "./mandate/mandate.js";
import { signMandate } from "./mandate/signing.js";
import { makeRails } from "./paypal/adapter.js";
import { Enforcer } from "./enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "./receipts/receipts.js";

const PORT = Number(process.env.PORT ?? 8790);
const KEYS_DIR = process.env.KEYS_DIR ?? ".keys";
const STATE_DIR = process.env.STATE_DIR ?? ".state";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
const keys = loadOrCreateKeys(KEYS_DIR);
const journal = new Journal(path.join(STATE_DIR, "journal.jsonl"), keys.journal);
const store = new MandateStore(path.join(STATE_DIR, "mandates.json"));
const rails = makeRails(process.env);
const enforcer = new Enforcer(journal, store, rails, keys, STATE_DIR);

const app = express();
app.use(express.json());
app.use(express.static(webRoot));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rails: rails.mode, journalLength: journal.length, uptimeSec: Math.round(process.uptime()) });
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

function formatForApi(minor: bigint, currency: string): string {
  const exp = currency === "JPY" ? 0 : 2;
  if (exp === 0) return minor.toString();
  const s = minor.toString().padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

app.listen(PORT, () => {
  console.log(`carte-blanche listening on http://localhost:${PORT} (rails: ${rails.mode})`);
});
