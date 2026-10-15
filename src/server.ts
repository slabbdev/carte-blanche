import express from "express";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadOrCreateKeys } from "./lib/keys.js";
import { Journal } from "./journal/journal.js";
import { MandateStore } from "./mandate/store.js";
import { newMandateId, validateMandate, type Mandate } from "./mandate/mandate.js";
import { signMandate } from "./mandate/signing.js";
import { verifyCanonical } from "./lib/sign.js";
import type { SignedMandate } from "./mandate/mandate.js";
import { makeRails, makePayPalClient } from "./paypal/adapter.js";
import { Enforcer } from "./enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "./receipts/receipts.js";
import { DisputeService } from "./disputes/service.js";
import { JourneyPlanner, journeyTotal, mandateLimitsFrom, executeJourney } from "./journey/journey.js";
import { PreferenceStore } from "./agent/preferences.js";
import { TrackRecordService } from "./agent/trackrecord.js";
import { configureAutopilot, runAutopilot, autopilotAvailable } from "./agent/autopilot.js";
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
// Third-party time anchoring: best-effort on sandbox and live (additive
// evidence, never a purchase gate); mock stays deterministic and offline.
const tsa = rails.mode === "mock" ? undefined : new TsaClient(process.env.TSA_URLS?.split(","));
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
// Purchase journeys: planned baskets that derive their own signed mandate and
// execute line by line through the enforcer (see /planner).
const paypal = makePayPalClient(process.env); // shared REST client (disputes + webhook verification)
configureAutopilot(journal, catalog, store, `http://localhost:${PORT}`);
const journeys = new JourneyPlanner(STATE_DIR, journal);
// The agent's journalled memory: what it knows about its principal, auditable like everything else.
const preferences = new PreferenceStore(STATE_DIR, journal);
// Portable, signed track records: what an agent DID, from the sealed chain —
// the raw material of agent reputation on these rails.
const trackRecords = new TrackRecordService(journal, keys.server);

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Demo auth: the merchant console sits behind a simulated PayPal login. The
// GATE is real — a server-side session; without it the pages 302 to /login.
// The login INTERFACE is a simulation: no PayPal OAuth, any credentials open
// a sandbox session, nothing here touches real PayPal authentication. Public
// verification stays public on purpose — "no account needed to verify a
// receipt" is a product claim, not an oversight.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "cb_session";
const SESSION_TTL_MS = 12 * 3_600_000;
const sessions = new Map<string, { sub: string; expiresAt: number }>();

function cookieToken(req: express.Request): string | undefined {
  const raw = (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(SESSION_COOKIE + "="));
  return raw?.slice(SESSION_COOKIE.length + 1);
}

function sessionOf(req: express.Request): { sub: string } | undefined {
  const token = cookieToken(req);
  if (!token) return undefined;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return undefined;
  return { sub: session.sub };
}

const GATED_PAGES = new Set(["/", "/index.html", "/dashboard", "/board", "/planner", "/oversight"]);
app.use((req, res, next) => {
  if (req.method === "GET" && GATED_PAGES.has(req.path) && !sessionOf(req)) {
    return res.redirect("/login?next=" + encodeURIComponent(req.path));
  }
  next();
});

app.use(express.static(webRoot));
app.use("/vendor", express.static(path.join(repoRoot, "node_modules", "ag-grid-community", "dist")));
app.use("/vendor/charts", express.static(path.join(repoRoot, "node_modules", "ag-charts-community", "dist", "umd")));
app.use("/vendor/bryntum", express.static(path.join(repoRoot, "node_modules", "@bryntum", "calendar-trial")));
app.use("/vendor/taskboard", express.static(path.join(repoRoot, "node_modules", "@bryntum", "taskboard-trial")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rails: rails.mode, journalLength: journal.length, catalog: catalog.enabled ? "channel3" : "sample", uptimeSec: Math.round(process.uptime()) });
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(webRoot, "login.html"));
});

app.post("/api/auth/login", (req, res) => {
  const body = (req.body ?? {}) as { email?: string; sub?: string };
  const sub = String(body.sub ?? "sandbox-merchant").slice(0, 64);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { sub, expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
  res.json({ ok: true, sub, redirect: "/dashboard" });
});

app.post("/api/auth/logout", (req, res) => {
  const token = cookieToken(req);
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/catalog", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 120);
  const pageToken = req.query.page_token ? String(req.query.page_token).slice(0, 200) : undefined;
  try {
    res.json(await catalog.search(q, 6, pageToken));
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

// Two issuance modes. Custodial (default): the server derives and signs the
// mandate with its own key. NON-CUSTODIAL: the caller brings a mandate already
// signed with THEIR Ed25519 key (the console signs it in the browser via
// WebCrypto) — the server verifies the signature against the caller's public
// key before storing anything, and journals rejected attempts as evidence.
// The enforcement path is identical: verifyMandate re-checks the stored
// signature, whoever holds it. "You keep the keys", literally.
app.post("/api/mandates", (req, res) => {
  const body = req.body as CreateMandateBody & { mandate?: Mandate; signature?: string; publicKey?: string };
  let signed: SignedMandate;
  let signing: "server-custodial" | "client-held-key";

  if (body.mandate && body.signature && body.publicKey) {
    const errors = validateMandate(body.mandate);
    if (errors.length > 0) return res.status(400).json({ errors });
    if (!verifyCanonical(body.publicKey, body.mandate, body.signature)) {
      journal.append("mandate_rejected", {
        reason: "client signature does not verify",
        principal: body.mandate.principal,
        agent: body.mandate.agent,
        public_key: body.publicKey.slice(0, 24),
      });
      return res.status(400).json({ error: "client signature does not verify — mandate not stored" });
    }
    signed = { mandate: body.mandate, signature: body.signature, publicKey: body.publicKey };
    signing = "client-held-key";
  } else {
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
    signed = signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64);
    signing = "server-custodial";
  }

  store.put(signed);
  journal.append("mandate_issued", {
    mandate_id: signed.mandate.id,
    principal: signed.mandate.principal,
    agent: signed.mandate.agent,
    signing,
  });
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

// --- purchase journeys (the planner: Channel3 lines -> signed mandate -> run) -
app.get("/api/journeys", (_req, res) => {
  res.json(journeys.list().map((j) => ({ ...j, total: journeyTotal(j) })));
});

app.get("/api/journeys/:id", (req, res) => {
  const j = journeys.get(req.params.id);
  if (!j) return res.status(404).json({ error: "journey not found" });
  res.json({ ...j, total: journeyTotal(j) });
});

app.post("/api/journeys", (req, res) => {
  const body = req.body as {
    name?: string;
    currency?: string;
    items?: Array<{ title?: string; merchant?: string; price?: string; quantity?: number }>;
  };
  const lines = (body.items ?? [])
    .filter((l) => l.title && l.price && /^\d+(\.\d+)?$/.test(String(l.price)))
    .map((l) => ({
      title: String(l.title),
      ...(l.merchant ? { merchant: String(l.merchant) } : {}),
      price: String(l.price),
      quantity: Number(l.quantity) || 1,
    }));
  if (lines.length === 0) return res.status(400).json({ error: "at least one line with title and numeric price is required" });
  const journey = journeys.plan(String(body.name ?? "shopping journey"), String(body.currency ?? "USD"), lines);
  res.status(201).json({ ...journey, total: journeyTotal(journey) });
});

app.post("/api/journeys/:id/lines", (req, res) => {
  const body = req.body as { title?: string; merchant?: string; price?: string; quantity?: number };
  if (!body.title || !body.price || !/^\d+(\.\d+)?$/.test(String(body.price))) {
    return res.status(400).json({ error: "title and numeric price are required" });
  }
  const j = journeys.addLine(req.params.id, {
    title: String(body.title),
    ...(body.merchant ? { merchant: String(body.merchant) } : {}),
    price: String(body.price),
    quantity: Number(body.quantity) || 1,
  });
  if (!j) return res.status(404).json({ error: "journey not found" });
  res.json({ ...j, total: journeyTotal(j) });
});

app.delete("/api/journeys/:id/lines/:lineId", (req, res) => {
  const j = journeys.removeLine(req.params.id, req.params.lineId);
  if (!j) return res.status(404).json({ error: "journey or line not found" });
  res.json({ ...j, total: journeyTotal(j) });
});

app.delete("/api/journeys/:id", (req, res) => {
  if (!journeys.remove(req.params.id)) return res.status(404).json({ error: "journey not found" });
  res.json({ ok: true });
});

// The human challenge: approving a journey derives a mandate from it — payee
// allowlist from the lines' merchants, per-purchase cap from the priciest
// line, total cap from the basket — and signs it. Lines added AFTER this
// point run into the same signed walls as anything else.
app.post("/api/journeys/:id/approve", (req, res) => {
  const j = journeys.get(req.params.id);
  if (!j) return res.status(404).json({ error: "journey not found" });
  if (j.mandateId) return res.status(409).json({ error: "journey already approved", mandateId: j.mandateId });
  if (j.items.length === 0) return res.status(400).json({ error: "nothing to approve — the journey has no lines" });
  const body = (req.body ?? {}) as { principal?: string; agent?: string };
  const limits = mandateLimitsFrom(j);
  const mandate: Mandate = {
    id: newMandateId(),
    version: "cb-mandate/v1",
    principal: String(body.principal ?? "sam (principal)"),
    agent: String(body.agent ?? "shopping-agent-1"),
    purpose: `journey: ${j.name}`,
    limits: {
      currency: j.currency,
      maxPerTransaction: limits.maxPerTransaction,
      maxTotalSpend: limits.maxTotalSpend,
      payees: limits.payees.length > 0 ? limits.payees : undefined,
      windowStart: new Date().toISOString(),
      windowEnd: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  const errors = validateMandate(mandate);
  if (errors.length > 0) return res.status(400).json({ errors });
  const signed = signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64);
  store.put(signed);
  journal.append("mandate_issued", { mandate_id: mandate.id, principal: mandate.principal, agent: mandate.agent });
  const approved = journeys.markApproved(j.id, mandate.id);
  res.json({ ...(approved as typeof j), total: journeyTotal(j), mandate: signed });
});

// Signed track record: the agent's verifiable reputation from the sealed chain.
// Merchants check "does this agent honor its walls" before accepting agent orders;
// buyers check it before delegating spending. No trust in us: the statement is
// signed and carries the chain tip it commits to.
app.get("/api/agents/:agent/track-record", (req, res) => {
  const agent = req.params.agent.trim();
  if (!agent) return res.status(400).json({ error: "agent name is required" });
  res.json(trackRecords.statementFor(agent));
});

// Autopilot: one call runs the agent ON THE SERVER under a mandate — LLM when
// OPENAI_API_KEY is configured, deterministic scripted policy otherwise. The
// front UI can drive the agent without the browser ever touching rails or keys.
app.post("/api/agent/autopilot", async (req, res) => {
  const body = req.body as { mandate_id?: string; goal?: string };
  if (!body.mandate_id || !body.goal) return res.status(400).json({ error: "mandate_id and goal are required" });
  try {
    const result = await runAutopilot(enforcer, { mandateId: String(body.mandate_id), goal: String(body.goal).slice(0, 160) });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: `autopilot failed: ${(e as Error).message}` });
  }
});

app.get("/api/agent/autopilot", (_req, res) => {
  res.json({ ...autopilotAvailable(), note: "llm requires OPENAI_API_KEY; otherwise the scripted policy runs" });
});

// --- PayPal webhooks: PayPal CONFIRMS what our journal claims ----------------
// When a capture completes, PayPal pushes the event here. We parse our agent
// marker out of custom_id and journal it as paypal-confirmed evidence — so the
// agent track record is no longer self-reported only: the rail itself co-signs
// the story. Signature verification runs when PAYPAL_WEBHOOK_ID is configured;
// otherwise the event is journalled with verified:false (honest, not trusted).
app.post("/api/webhooks/paypal", async (req, res) => {
  const event = req.body as {
    id?: string;
    event_type?: string;
    resource?: { id?: string; custom_id?: string; amount?: { value?: string; currency_code?: string } };
  } | undefined;
  if (!event?.event_type) return res.status(400).json({ error: "not a PayPal webhook event" });

  const customId = event.resource?.custom_id ?? "";
  const markerMatch = /^cb\|agent=([^|]+)\|mandate=([^|]+)/.exec(customId);
  let verified = false;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (webhookId && paypal) {
    try {
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? String(v[0]) : String(v ?? "")]),
      );
      verified = await paypal.verifyWebhookSignature(req.body as Record<string, unknown>, headers, webhookId);
    } catch {
      verified = false;
    }
  }

  journal.append("paypal_webhook", {
    event_id: event.id ?? "",
    event_type: event.event_type,
    resource_id: event.resource?.id ?? "",
    amount: event.resource?.amount ?? null,
    custom_id: customId.slice(0, 200) || null,
    ...(markerMatch ? { agent: markerMatch[1], mandate_id: markerMatch[2] } : {}),
    verified,
    verification: webhookId ? "paypal verify-webhook-signature" : "skipped (PAYPAL_WEBHOOK_ID not set)",
  });
  res.json({ received: true });
});

// --- agent memory: journalled preferences the agent (and any MCP client) reads/writes
app.get("/api/agent/preferences", (_req, res) => {
  res.json(preferences.get());
});

app.post("/api/agent/preferences", (req, res) => {
  const body = req.body as { key?: string; value?: string; why?: string; note?: string };
  try {
    if (body.note) return res.json(preferences.note(String(body.note)));
    if (!body.key || !body.value) return res.status(400).json({ error: "key and value are required (or pass note)" });
    res.json(preferences.set(String(body.key), String(body.value), body.why ? String(body.why) : undefined));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Run: every still-planned line goes through the enforcer, in order. Off-list
// merchants and over-budget lines come back as signed refusals right in the
// grid — the basket meets the same walls as any single purchase.
app.post("/api/journeys/:id/run", async (req, res) => {
  const j = journeys.get(req.params.id);
  if (!j) return res.status(404).json({ error: "journey not found" });
  if (!j.mandateId) return res.status(409).json({ error: "approve the journey first — there is no mandate to spend under" });
  try {
    const after = await executeJourney(j, journal, enforcer);
    res.json({ ...after, total: journeyTotal(after) });
  } catch (e) {
    res.status(502).json({ error: `journey execution failed: ${(e as Error).message}` });
  }
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
    funding?: string;
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
      funding: body.funding === "wallet" ? "wallet" : undefined,
    });
    if (outcome.kind === "pending") {
      return res.json({
        outcome: "pending",
        logicalKey: outcome.logicalKey,
        orderId: outcome.orderId,
        approvalUrl: outcome.approvalUrl,
        note: "wallet order awaiting buyer approval at the redirect; POST /api/agent/purchase/resume with logicalKey once approved",
      });
    }
    res.json(outcome.kind === "receipt" ? { outcome: "receipt", ...outcome.full } : { outcome: "denial", ...outcome.full });
  } catch (e) {
    res.status(502).json({ error: `rails failure: ${(e as Error).message}` });
  }
});

app.post("/api/agent/purchase/resume", async (req, res) => {
  const body = req.body as { logical_key?: string };
  if (!body.logical_key) return res.status(400).json({ error: "logical_key is required" });
  try {
    const outcome = await enforcer.resumePurchase(body.logical_key);
    if (outcome.kind === "pending") {
      return res.status(409).json({ outcome: "pending", orderId: outcome.orderId, approvalUrl: outcome.approvalUrl });
    }
    res.json(outcome.kind === "receipt" ? { outcome: "receipt", ...outcome.full } : { outcome: "denial", ...outcome.full });
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
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

// Anchor the current journal position with the TSA, on demand. Additive
// evidence only — no money path touches this — so the route stays open POST:
// it lets a scheduled job (Render cron) keep the "provable WHEN" continuous
// instead of anchoring only when a purchase happens.
app.post("/api/journal/anchor", async (_req, res) => {
  if (!tsa) {
    return res.status(400).json({ error: "anchoring is disabled in mock mode (deterministic offline demo)" });
  }
  if (journal.length === 0) {
    return res.status(422).json({ error: "journal is empty — nothing to anchor yet" });
  }
  try {
    const anchor = await journal.anchorTreeHead(tsa);
    res.json({ ok: true, size: anchor.size, root: anchor.root, tsa: anchor.tsaUrl, genTime: anchor.genTime });
  } catch (e) {
    res.status(502).json({ error: `TSA anchor failed: ${(e as Error).message}` });
  }
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

// The TaskBoard kanban is a page of its own: Bryntum trial UMD bundles cannot
// share one page (a second bundle silently refuses the populated namespace).
app.get("/board", (_req, res) => {
  res.sendFile(path.join(webRoot, "board.html"));
});

// The journey planner hosts the TaskBoard bundle (so /board's constraint holds):
// Channel3 lines -> signed basket-mandate -> enforcer run, with an AG Grid
// auto-generated from the lines.
app.get("/planner", (_req, res) => {
  res.sendFile(path.join(webRoot, "planner.html"));
});

// The buyer's oversight tab: spend, memory, walls honored — and the STOP switch.
app.get("/oversight", (_req, res) => {
  res.sendFile(path.join(webRoot, "oversight.html"));
});

// Machine-readable API contract (APIMatic/Redoc/Postman can consume it as-is).
app.get("/openapi.json", (_req, res) => {
  res.sendFile(path.join(repoRoot, "docs", "openapi.json"));
});

app.get("/docs", (_req, res) => {
  res.sendFile(path.join(webRoot, "docs.html"));
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
