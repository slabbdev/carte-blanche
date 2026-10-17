import express from "express";
import path from "node:path";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadOrCreateKeys } from "./lib/keys.js";
import { Journal } from "./journal/journal.js";
import { MandateStore } from "./mandate/store.js";
import { addPeriodsMs, formatAmount, newMandateId, parseAmount, validateMandate, type Mandate } from "./mandate/mandate.js";
import { signMandate } from "./mandate/signing.js";
import { verifyCanonical } from "./lib/sign.js";
import type { SignedMandate } from "./mandate/mandate.js";
import { makeRails, makePayPalClient } from "./paypal/adapter.js";
import { Enforcer } from "./enforcer/enforcer.js";
import { verifyFullReceipt, verifyFullDenial } from "./receipts/receipts.js";
import { DisputeService } from "./disputes/service.js";
import { DisputeRuleStore } from "./disputes/rules.js";
import { AgentPassportStore } from "./agent/passport.js";
import { JourneyPlanner, journeyTotal, mandateLimitsFrom, executeJourney } from "./journey/journey.js";
import { PreferenceStore } from "./agent/preferences.js";
import { TrackRecordService } from "./agent/trackrecord.js";
import { configureAutopilot, runAutopilot, autopilotAvailable } from "./agent/autopilot.js";
import { buildEvidencePack, fulfillmentFor, toMarkdown, toProvideEvidenceEntries } from "./disputes/evidence.js";
import { Channel3Catalog, parsePriceWebhook } from "./catalog/channel3.js";

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
const agentPassports = new AgentPassportStore(path.join(STATE_DIR, "agent-passports.json"));
const enforcer = new Enforcer(journal, store, rails, keys, STATE_DIR, { tsa, passports: agentPassports });
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
const disputeRules = new DisputeRuleStore(path.join(STATE_DIR, "dispute-rules.json"));
configureAutopilot(journal, catalog, store, `http://localhost:${PORT}`);
const journeys = new JourneyPlanner(STATE_DIR, journal);
// The agent's journalled memory: what it knows about its principal, auditable like everything else.
const preferences = new PreferenceStore(STATE_DIR, journal);
// Portable, signed track records: what an agent DID, from the sealed chain —
// the raw material of agent reputation on these rails.
const trackRecords = new TrackRecordService(journal, keys.server);

const app = express();
app.set("trust proxy", 1); // behind Render's proxy: req.protocol must be https for the OIDC redirect URI
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
interface AccountProfile {
  name?: string; givenName?: string; email?: string; payerId?: string;
  accountType?: "business" | "personal" | "paypal";
}
const sessions = new Map<string, { sub: string; expiresAt: number; profile?: AccountProfile }>();
const oidcStates = new Map<string, string>(); // state → next path (anti-CSRF, one-time)

// Sessions + OIDC states survive process death. The free tier SPINS DOWN
// after 15 idle minutes (that's the OAuth killer: the buyer sits on PayPal's
// consent page, the instance sleeps, the callback 502s into a dead process).
// Render's ephemeral storage survives spin-down (only deploys wipe it), so a
// small JSON file is enough to make logins — and in-flight OAuth hand-offs —
// survive sleep, cold starts and crashes.
const WEB_SESSIONS_FILE = path.join(STATE_DIR, "web-sessions.json");

function loadWebSessions(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(WEB_SESSIONS_FILE, "utf8")) as {
      sessions: Array<[string, { sub: string; expiresAt: number; profile?: AccountProfile }]>;
      oidcStates: Array<[string, string]>;
    };
    const now = Date.now();
    for (const [token, s] of raw.sessions ?? []) {
      if (s.expiresAt > now) sessions.set(token, s);
    }
    for (const [state, next] of raw.oidcStates ?? []) oidcStates.set(state, next);
  } catch {
    /* no file yet — fresh start */
  }
}

loadWebSessions();

let persistTimer: NodeJS.Timeout | undefined;
function persistWebSessions(): void {
  // debounced: bursts of session writes cost one file write
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const cutoff = Date.now();
      const liveSessions = [...sessions.entries()].filter(([, s]) => s.expiresAt > cutoff);
      fs.writeFileSync(
        WEB_SESSIONS_FILE,
        JSON.stringify({ sessions: liveSessions, oidcStates: [...oidcStates.entries()] }),
      );
    } catch {
      /* persistence is best-effort — the in-memory maps keep serving */
    }
  }, 250);
}

function cookieToken(req: express.Request): string | undefined {
  const raw = (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(SESSION_COOKIE + "="));
  return raw?.slice(SESSION_COOKIE.length + 1);
}

function sessionOf(req: express.Request): { sub: string; profile?: AccountProfile } | undefined {
  const token = cookieToken(req);
  if (!token) return undefined;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return undefined;
  return { sub: session.sub, profile: session.profile };
}

// One PayPal login opens the whole app — PayPal's own model: the same account
// is the buyer of one dispute and the seller of another. Page gating is the
// SPA's job now (redirect on 401 from /api/auth/me); the API boundary itself
// stays the sealed-evidence layer, publicly verifiable by design.

// who am I — pages read this to greet the account
app.get("/api/auth/me", (req, res) => {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ error: "no session" });
  res.json({ sub: session.sub, profile: session.profile ?? null });
});

// The BUYER face of the Resolution Center: contestations sealed from
// /oversight, straight from the journal, enriched with the receipt's story.
app.get("/api/my/contestations", (_req, res) => {
  const rows = journal.eventsOfType("buyer_dispute_requested").map((e) => {
    const d = e.data as Record<string, unknown>;
    const receipt = enforcer.listReceipts().find((r) => r.receiptId === d.receipt_id);
    return {
      sealedAt: e.ts,
      seq: e.seq,
      event_hash: e.hash,
      receiptId: String(d.receipt_id ?? ""),
      orderId: String(d.order_id ?? ""),
      amount: String(d.amount ?? ""),
      currency: String(d.currency ?? ""),
      reason: String(d.buyer_reason ?? ""),
      note: String(d.buyer_note ?? ""),
      description: receipt?.description ?? "",
      status: "SEALED — not filed on PayPal yet",
      verify: `/verify/${String(d.receipt_id ?? "")}`,
    };
  }).reverse();
  res.json({ contestations: rows, note: "filing happens on PayPal's own Resolution Center — the seal is your proof and travels with you" });
});

app.use(express.static(webRoot));
app.use("/vendor", express.static(path.join(repoRoot, "node_modules", "ag-grid-community", "dist")));
app.use("/vendor/charts", express.static(path.join(repoRoot, "node_modules", "ag-charts-community", "dist", "umd")));
app.use("/vendor/bryntum", express.static(path.join(repoRoot, "node_modules", "@bryntum", "calendar-trial")));
app.use("/vendor/taskboard", express.static(path.join(repoRoot, "node_modules", "@bryntum", "taskboard-trial")));
app.use("/vendor/paypal-js", express.static(path.join(repoRoot, "node_modules", "@paypal", "paypal-js", "dist", "iife")));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rails: rails.mode, journalLength: journal.length, catalog: catalog.enabled ? "channel3" : "sample", uptimeSec: Math.round(process.uptime()) });
});

// Client config for the browser-side PayPal SDK. The client id is public by
// design (it identifies the app, it does not authenticate anything); the
// secrets stay server-side. The Buttons rendered with it create orders THROUGH
// the enforcer — the browser never holds rail access.
app.get("/api/config", (_req, res) => {
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID ?? null,
    environment: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
    mode: rails.mode,
  });
});

app.post("/api/auth/login", (req, res) => {
  const body = (req.body ?? {}) as { email?: string; sub?: string };
  const sub = String(body.sub ?? "sandbox-merchant").slice(0, 64);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { sub, expiresAt: Date.now() + SESSION_TTL_MS });
  persistWebSessions();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
  res.json({ ok: true, sub, redirect: "/" });
});

app.post("/api/auth/logout", (req, res) => {
  const token = cookieToken(req);
  if (token) sessions.delete(token);
  persistWebSessions();
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
  /** Standing authority: slice the window into repeating budgets. */
  recurrence?: { frequency?: string; max_per_window?: string };
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
    const recurrence:
      | { frequency: "monthly" | "weekly"; maxPerWindow: string }
      | undefined =
      body.recurrence && (body.recurrence.frequency === "monthly" || body.recurrence.frequency === "weekly")
        ? { frequency: body.recurrence.frequency, maxPerWindow: String(body.recurrence.max_per_window ?? body.max_total_spend ?? "0.00") }
        : undefined;
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
        ...(recurrence ? { recurrence } : {}),
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
    items?: Array<{ title?: string; merchant?: string; product_id?: string; price?: string; quantity?: number }>;
  };
  const lines = (body.items ?? [])
    .filter((l) => l.title && l.price && /^\d+(\.\d+)?$/.test(String(l.price)))
    .map((l) => ({
      title: String(l.title),
      ...(l.merchant ? { merchant: String(l.merchant) } : {}),
      ...(l.product_id ? { productId: String(l.product_id) } : {}),
      price: String(l.price),
      quantity: Number(l.quantity) || 1,
    }));
  if (lines.length === 0) return res.status(400).json({ error: "at least one line with title and numeric price is required" });
  const journey = journeys.plan(String(body.name ?? "shopping journey"), String(body.currency ?? "USD"), lines);
  res.status(201).json({ ...journey, total: journeyTotal(journey) });
});

app.post("/api/journeys/:id/lines", (req, res) => {
  const body = req.body as { title?: string; merchant?: string; product_id?: string; price?: string; quantity?: number };
  if (!body.title || !body.price || !/^\d+(\.\d+)?$/.test(String(body.price))) {
    return res.status(400).json({ error: "title and numeric price are required" });
  }
  const j = journeys.addLine(req.params.id, {
    title: String(body.title),
    ...(body.merchant ? { merchant: String(body.merchant) } : {}),
    ...(body.product_id ? { productId: String(body.product_id) } : {}),
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
// point run into the same signed walls as anything else. With
// `{"recurrence":"monthly","months":12}` the SAME basket becomes a standing
// authority: window stretched to N periods, per-window budget = basket,
// mandate-wide cap = basket × N ("this basket, every month, for a year").
app.post("/api/journeys/:id/approve", (req, res) => {
  const j = journeys.get(req.params.id);
  if (!j) return res.status(404).json({ error: "journey not found" });
  if (j.mandateId) return res.status(409).json({ error: "journey already approved", mandateId: j.mandateId });
  if (j.items.length === 0) return res.status(400).json({ error: "nothing to approve — the journey has no lines" });
  const body = (req.body ?? {}) as { principal?: string; agent?: string; recurrence?: string; months?: number };
  const recurrence =
    body.recurrence === "monthly" || body.recurrence === "weekly" ? body.recurrence : undefined;
  const periods = Math.max(1, Math.min(24, Math.round(Number(body.months) || 12)));
  const limits = mandateLimitsFrom(j);
  const nowMs = Date.now();
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
      ...(recurrence
        ? {
            recurrence: { frequency: recurrence, maxPerWindow: journeyTotal(j) },
            maxTotalSpend: formatAmount(
              parseAmount(journeyTotal(j), j.currency) * BigInt(periods),
              j.currency,
            ),
          }
        : {}),
      windowStart: new Date(nowMs).toISOString(),
      windowEnd: recurrence
        ? new Date(addPeriodsMs(nowMs, recurrence, periods)).toISOString()
        : new Date(nowMs + 7 * 24 * 3_600_000).toISOString(),
    },
    issuedAt: new Date().toISOString(),
  };
  const errors = validateMandate(mandate);
  if (errors.length > 0) return res.status(400).json({ errors });
  const signed = signMandate(mandate, keys.server.privateKeyB64, keys.server.publicKeyB64);
  store.put(signed);
  journal.append("mandate_issued", { mandate_id: mandate.id, principal: mandate.principal, agent: mandate.agent });
  const approved = journeys.markApproved(j.id, mandate.id, recurrence ? { frequency: recurrence } : undefined);
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
    resource?: {
      id?: string;
      custom_id?: string;
      amount?: { value?: string; currency_code?: string };
      // dispute resources (CUSTOMER.DISPUTE.*)
      dispute_id?: string;
      status?: string;
      reason?: string;
      dispute_life_cycle_stage?: string;
      disputed_transaction?: { seller_transaction_id?: string };
    };
  } | undefined;
  if (!event?.event_type) return res.status(400).json({ error: "not a PayPal webhook event" });

  const isDispute = event.event_type.startsWith("CUSTOMER.DISPUTE");
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
    ...(isDispute ? {
      dispute_id: event.resource?.dispute_id ?? event.resource?.id ?? "",
      dispute_status: event.resource?.status ?? "",
      dispute_reason: event.resource?.reason ?? "",
      dispute_stage: event.resource?.dispute_life_cycle_stage ?? "",
      seller_transaction_id: event.resource?.disputed_transaction?.seller_transaction_id ?? "",
    } : {}),
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
// grid — the basket meets the same walls as any single purchase. A recurring
// journey re-runs per period: `{"cycle": "2026-11"}` re-attempts every line
// with cycle-scoped logical keys under the same recurring mandate.
app.post("/api/journeys/:id/run", async (req, res) => {
  const j = journeys.get(req.params.id);
  if (!j) return res.status(404).json({ error: "journey not found" });
  if (!j.mandateId) return res.status(409).json({ error: "approve the journey first — there is no mandate to spend under" });
  const body = (req.body ?? {}) as { cycle?: string; drop_seq?: number | string };
  const cycle = body.cycle?.trim();
  if (cycle && !/^\d{4}-\d{2}$/.test(cycle)) {
    return res.status(400).json({ error: 'cycle must look like "YYYY-MM"' });
  }
  // a price-drop re-run gets its own logical-key scope: the same drop re-clicked
  // stays idempotent, a NEW drop is a genuinely new purchase at the new price
  const dropSeq = String(body.drop_seq ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  try {
    const after = await executeJourney(j, journal, enforcer, {
      ...(cycle ? { cycle } : {}),
      ...(dropSeq ? { keySuffix: `drop${dropSeq}` } : {}),
    });

    // PRICE PROTECTION: a drop-scoped re-run whose lines hit a budget wall,
    // where the SAME item was already purchased this window at a higher
    // price, refunds the difference through the rail. The promo applies to
    // money already spent — that is what price protection means.
    const protection: Array<{ line: string; amount: string; currency: string; refundId?: string; simulated?: boolean; paypalStatus?: number; detail?: string }> = [];
    if (dropSeq) {
      const updates = [...journal.eventsOfType("journey_line_price_updated")].reverse();
      for (const item of after.items.filter((i) => i.status === "refused" && /OVER_(WINDOW|TOTAL)_CAP/.test(i.detail ?? ""))) {
        const upd = updates.find((e) => (e.data as any).line_id === item.id);
        const receipt = enforcer
          .listReceipts(j.mandateId)
          .find((r) => item.title && r.description.includes(item.title));
        if (!upd || !receipt) continue;
        const d = upd.data as { old_price?: string; new_price?: string };
        const cur = item.currency || "USD";
        let diffMinor = 0n;
        try {
          diffMinor = parseAmount(String(d.old_price), cur) - parseAmount(String(d.new_price), cur);
        } catch { continue; }
        if (diffMinor <= 0n) continue;
        const diff = formatAmount(diffMinor, cur);
        if (rails.mode !== "mock" && paypal) {
          const rf = await paypal.refundCapture({
            captureId: receipt.captureId,
            amount: diff,
            currency: cur,
            note: `carte-blanche price protection: dropped from ${d.old_price} to ${d.new_price}`,
            requestId: `cb-droprefund-${item.id}-${dropSeq}`.slice(0, 64),
          });
          const refundId = (rf.data as { id?: string } | undefined)?.id ?? "";
          protection.push({ line: item.title, amount: diff, currency: cur, ...(refundId ? { refundId } : {}), paypalStatus: rf.status, ...(!rf.ok ? { detail: JSON.stringify(rf.data ?? {}).slice(0, 200) } : {}) });
          journal.append("journey_price_protection", {
            journey_id: j.id, line_id: item.id, receipt_id: receipt.receiptId, capture_id: receipt.captureId,
            amount: diff, currency: cur, ...(refundId ? { refund_id: refundId } : {}),
            paypal_status: rf.status, source: "price drop re-run",
          });
        } else {
          // mock rails: no PayPal client — journal the intent, visibly simulated
          protection.push({ line: item.title, amount: diff, currency: cur, simulated: true, detail: "mock rails: the refund is journalled as intent only" });
          journal.append("journey_price_protection", {
            journey_id: j.id, line_id: item.id, amount: diff, currency: cur,
            simulated: true, source: "price drop re-run (mock)",
          });
        }
      }
    }

    journeys.persistNow();
    res.json({ ...after, total: journeyTotal(after), ...(protection.length ? { price_protection: protection } : {}) });
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
    /** The buyer's activation words — assistants (MCP/Actions) MUST pass them. */
    intent_text?: string;
    intent_channel?: string;
    intent_session?: string;
    agent_passport_id?: string;
    agent_proof_signature?: string;
    agent_proof_ts?: string;
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
      ...(body.intent_text ? {
        intent: {
          text: String(body.intent_text),
          ...(body.intent_channel ? { channel: String(body.intent_channel) } : {}),
          ...(body.intent_session ? { sessionRef: String(body.intent_session) } : {}),
        },
      } : {}),
      ...(body.agent_passport_id && body.agent_proof_signature ? {
        agentProof: {
          agentId: String(body.agent_passport_id),
          signature: String(body.agent_proof_signature),
          ts: String(body.agent_proof_ts ?? new Date().toISOString()),
        },
      } : {}),
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

// The BUYER-side dispute flow. Filing happens on PayPal's side (their Disputes
// API is merchant-facing); what we seal is the buyer's contestation INTENT the
// moment it forms — reason, receipt, order, amount — so the buyer walks into
// PayPal's flow carrying signed evidence, not screenshots.
app.post("/api/receipts/:id/dispute-request", (req, res) => {
  const receipt = enforcer.listReceipts().find((r) => r.receiptId === req.params.id);
  if (!receipt) return res.status(404).json({ error: "receipt not found" });
  const reason = String((req.body as { reason?: string } | undefined)?.reason ?? "ITEM_NOT_RECEIVED").slice(0, 60);
  const note = String((req.body as { note?: string } | undefined)?.note ?? "").slice(0, 400);
  const event = journal.append("buyer_dispute_requested", {
    receipt_id: receipt.receiptId,
    mandate_id: receipt.mandateId,
    order_id: receipt.orderId,
    capture_id: receipt.captureId,
    amount: receipt.amount,
    currency: receipt.currency,
    buyer_reason: reason,
    ...(note ? { buyer_note: note } : {}),
    rail: "paypal",
  });
  res.status(201).json({
    ok: true,
    journaled: { seq: event.seq, event_hash: event.hash, ts: event.ts },
    receipt: { receiptId: receipt.receiptId, orderId: receipt.orderId, amount: receipt.amount, currency: receipt.currency },
    next: "file on PayPal (Resolution Center) — this receipt's signed evidence pack travels with you",
    verify: `/verify/${receipt.receiptId}`,
  });
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

// The TaskBoard kanban is a page of its own: Bryntum trial UMD bundles cannot
// share one page (a second bundle silently refuses the populated namespace).
// The journey planner hosts the TaskBoard bundle (so /board's constraint holds):
// Channel3 lines -> signed basket-mandate -> enforcer run, with an AG Grid
// auto-generated from the lines.
// The buyer's oversight tab: spend, memory, walls honored — and the STOP switch.
// Machine-readable API contract (APIMatic/Redoc/Postman can consume it as-is).
app.get("/openapi.json", (_req, res) => {
  res.sendFile(path.join(repoRoot, "docs", "openapi.json"));
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
  res.json({ pack, markdown: toMarkdown(pack), entries: toProvideEvidenceEntries(pack) });
});

// The fulfillment slot: carrier + tracking for an order, journalled (tamper-
// evident) and shaped for PayPal's PROOF_OF_FULFILLMENT tracking_info. The
// merchant's fulfillment system posts here; every dispute on that order gains
// the slot automatically at pack-generation time. On sandbox/live rails the
// same record is ALSO pushed to PayPal's Shipment Tracking (/v1/shipping/
// trackers) — the tracker sits on THEIR record: faster fund release, Seller
// Protection eligibility, dispute evidence at the arbiter's side of the table.
app.post("/api/orders/:orderId/fulfillment", async (req, res) => {
  const body = (req.body ?? {}) as { carrier?: string; tracking_number?: string; shipped_at?: string };
  const carrier = String(body.carrier ?? "").trim().slice(0, 80);
  const tracking = String(body.tracking_number ?? "").trim().slice(0, 80);
  if (!carrier || !tracking) {
    return res.status(400).json({ error: "carrier and tracking_number are required" });
  }
  const shippedAt = body.shipped_at ? new Date(body.shipped_at).toISOString() : new Date().toISOString();
  const event = journal.append("order_fulfilled", {
    order_id: req.params.orderId,
    carrier,
    tracking_number: tracking,
    shipped_at: shippedAt,
    source: "merchant fulfillment",
  });

  // Bilateral mode: also register the tracker on PayPal's side.
  let paypalTracker: { ok: boolean; trackerId?: string; httpStatus: number; detail?: string } | undefined;
  if (rails.mode !== "mock" && paypal) {
    const receipt = enforcer.listReceipts().find((r) => r.orderId === req.params.orderId);
    if (receipt) {
      // PayPal's carrier field draws from their supported list; uppercase
      // snake is the closest safe projection — a rejection is journaled
      // honestly, the local slot stands either way.
      const paypalCarrier = carrier.toUpperCase().replace(/\s+/g, "_").slice(0, 40);
      const tr = await paypal.createTracker({
        captureId: receipt.captureId,
        trackingNumber: tracking,
        carrier: paypalCarrier,
      });
      const tid = (tr.data as { tracker_identifiers?: Array<{ transaction_id: string; tracking_number: string }> } | undefined)
        ?.tracker_identifiers?.[0];
      const trackerId = tid ? `${tid.transaction_id}-${tid.tracking_number}` : undefined;
      paypalTracker = {
        ok: tr.ok,
        ...(trackerId ? { trackerId } : {}),
        httpStatus: tr.status,
        ...(!tr.ok ? { detail: JSON.stringify(tr.data ?? {}).slice(0, 300) } : {}),
      };
      journal.append("paypal_tracker_created", {
        order_id: req.params.orderId,
        capture_id: receipt.captureId,
        carrier: paypalCarrier,
        tracking_number: tracking,
        ok: tr.ok,
        ...(trackerId ? { tracker_id: trackerId } : {}),
        paypal_status: tr.status,
      });
    } else {
      paypalTracker = { ok: false, httpStatus: 0, detail: "no captured receipt for this order — tracker needs a capture id" };
    }
  }

  res.status(201).json({
    ok: true,
    journaled: { seq: event.seq, event_hash: event.hash, ts: event.ts },
    order_id: req.params.orderId,
    evidence_slot: "PROOF_OF_FULFILLMENT",
    ...(paypalTracker ? { paypal_tracker: paypalTracker } : {}),
    note: paypalTracker
      ? paypalTracker.ok
        ? "journalled AND registered on PayPal's record (seller protection + faster fund release)"
        : "journalled locally; PayPal tracker rejected — see paypal_tracker.detail"
      : "journalled (mock rails: PayPal tracker is a sandbox/live operation)",
  });
});

app.get("/api/orders/:orderId/fulfillment", (req, res) => {
  const f = fulfillmentFor(journal, req.params.orderId);
  if (!f) return res.status(404).json({ error: "no fulfillment record for this order" });
  res.json(f);
});

// The fast lane: settle-or-fight, answered by coverage. `refund` issues a real
// PayPal refund on the captured payment (inside the inquiry window: no
// chargeback escalation, no $15–30 dispute fee) and journals it; `fight`
// returns the evidence pack's targeted entries ready for provide-evidence.
app.post("/api/disputes/:id/fast-lane", async (req, res) => {
  const d = await disputes.get(req.params.id).catch(() => undefined);
  if (!d) return res.status(404).json({ error: "dispute not found" });
  const action = (req.body as { action?: string } | undefined)?.action;
  if (action !== "refund" && action !== "fight") {
    return res.status(400).json({ error: 'action must be "refund" or "fight"' });
  }
  const pack = buildEvidencePack(d, { enforcer, journal, store, keys });

  if (action === "fight") {
    journal.append("dispute_fastlane_decision", { dispute_id: d.disputeId, action: "fight", recommendation: pack.recommendation.action });
    return res.json({
      action: "fight",
      recommendation: pack.recommendation,
      coverage: pack.coverage,
      entries: toProvideEvidenceEntries(pack),
      submit: `POST /api/disputes/${d.disputeId}/submit-evidence`,
    });
  }

  if (rails.mode === "mock") {
    return res.status(409).json({ error: "mock rails: refunding is a PayPal-side operation — the recommendation itself is real", recommendation: pack.recommendation });
  }
  if (!paypal) return res.status(502).json({ error: "PayPal client unavailable" });
  const captureId = pack.linkedPurchase?.receipt.captureId ?? d.disputedTransactions?.[0]?.transaction_id;
  if (!captureId) return res.status(409).json({ error: "no capture id found for this dispute — cannot refund" });
  const refund = await paypal.refundCapture({
    captureId,
    amount: d.amount,
    currency: d.currency,
    note: `carte-blanche fast lane: settled dispute ${d.disputeId} inside the inquiry window`,
    requestId: `cb-fastlane-${d.disputeId}`.slice(0, 64),
  });
  const refundId = (refund.data as { id?: string } | undefined)?.id ?? "";
  const event = journal.append("dispute_fastlane_refund", {
    dispute_id: d.disputeId,
    capture_id: captureId,
    ...(refundId ? { refund_id: refundId } : {}),
    amount: d.amount,
    currency: d.currency,
    paypal_status: refund.status,
    reason: "settled inside the inquiry window — no chargeback escalation, no dispute fee",
  });
  res.json({
    action: "refund",
    ok: refund.ok,
    refundId,
    paypal_status: refund.status,
    journaled: { seq: event.seq, event_hash: event.hash },
    note: refund.ok
      ? "refund issued — the inquiry settles without escalation and the dispute fee never lands"
      : "refund rejected by PayPal — details in paypal_status",
  });
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

// --- Channel3 price tracking: "time-to-buy" for standing baskets --------------
// Track a journey line's canonical product; Channel3 fires a webhook the
// moment the price moves. The drop is journalled — then the buyer/agent re-runs
// the cycle under the SAME recurring mandate and the walls still apply. This
// is the sponsor-pairing story: their deal-finder machinery, our enforcement.
// (Webhook endpoint registration happens in THEIR dashboard — account-side.)

app.post("/api/catalog/track", async (req, res) => {
  const body = (req.body ?? {}) as { product_id?: string; title?: string };
  const productId = String(body.product_id ?? "").trim().slice(0, 64);
  if (!productId) return res.status(400).json({ error: "product_id is required (a Channel3 canonical product id)" });
  if (!catalog.enabled) return res.status(409).json({ error: "channel3 disabled (no api key) — tracking is a live-API surface" });
  const out = await catalog.startPriceTracking(productId);
  const event = journal.append("channel3_price_tracking_started", {
    product_id: productId,
    ...(body.title ? { title: String(body.title).slice(0, 140) } : {}),
    ok: out.ok,
    channel3_status: out.status,
  });
  res.status(out.ok ? 201 : 502).json({
    ok: out.ok,
    product_id: productId,
    channel3_status: out.status,
    ...(out.detail ? { detail: out.detail } : {}),
    journaled: { seq: event.seq },
    note: out.ok ? "webhooks arrive at POST /api/webhooks/channel3 (register it in the Channel3 dashboard)" : undefined,
  });
});

app.get("/api/catalog/track", async (_req, res) => {
  if (!catalog.enabled) return res.status(409).json({ error: "channel3 disabled (no api key)" });
  const subs = await catalog.listPriceSubscriptions();
  if (!subs) return res.status(502).json({ error: "channel3 subscriptions unavailable" });
  res.json({ subscriptions: subs });
});

app.delete("/api/catalog/track/:productId", async (req, res) => {
  if (!catalog.enabled) return res.status(409).json({ error: "channel3 disabled (no api key)" });
  const out = await catalog.stopPriceTracking(req.params.productId);
  journal.append("channel3_price_tracking_stopped", { product_id: req.params.productId, ok: out.ok, channel3_status: out.status });
  res.status(out.ok ? 200 : 502).json({ ok: out.ok, channel3_status: out.status });
});

app.get("/api/catalog/track/:productId/history", async (req, res) => {
  if (!catalog.enabled) return res.status(409).json({ error: "channel3 disabled (no api key)" });
  const history = await catalog.priceHistory(req.params.productId);
  if (!history) return res.status(502).json({ error: "price history unavailable for this product" });
  res.json({ product_id: req.params.productId, price_history: history });
});

// Their webhook: {type:"price.changed", data:{canonical_product_id,new_price,currency}}.
// Their docs document NO signature scheme — so we journal honestly (unverified
// by construction) and the evidence layer treats it as a TRIGGER, not as proof.
app.post("/api/webhooks/channel3", (req, res) => {
  const parsed = parsePriceWebhook(req.body);
  if (parsed.kind === "ignored") {
    return res.status(202).json({ received: true, ignored: true, detail: parsed.detail });
  }
  // which journeys care about this product?
  const applied = journeys.applyPriceDrop(parsed.productId, parsed.newPrice);
  const affected = journeys.list().filter((j) => j.items.some((i) => i.productId === parsed.productId));
  const event = journal.append("channel3_price_drop", {
    product_id: parsed.productId,
    new_price: parsed.newPrice,
    currency: parsed.currency,
    ...(parsed.oldPrice ? { old_price: parsed.oldPrice } : {}),
    source: "channel3 webhook",
    signature: "none documented by channel3 — treated as a trigger, not as proof",
    lines_updated: applied.length,
    ...(affected.length ? { journeys: affected.map((j) => j.id) } : {}),
  });
  res.json({ received: true, journaled: { seq: event.seq }, lines_updated: applied.length, journeys_affected: affected.length });
});

// Demo injection, visibly labeled SAMPLE: lets the drop→re-run story play in
// front of judges without waiting for a real market move.
app.post("/api/catalog/price-sample", (req, res) => {
  const body = (req.body ?? {}) as { product_id?: string; price?: string; old_price?: string; currency?: string };
  const productId = String(body.product_id ?? "").trim().slice(0, 64);
  const price = /^\d+(\.\d+)?$/.test(String(body.price ?? "")) ? String(body.price) : "";
  if (!productId || !price) return res.status(400).json({ error: "product_id and numeric price are required" });
  const oldPrice = /^\d+(\.\d+)?$/.test(String(body.old_price ?? "")) ? String(body.old_price) : undefined;
  const applied = journeys.applyPriceDrop(productId, price);
  const affected = journeys.list().filter((j) => j.items.some((i) => i.productId === productId));
  const event = journal.append("channel3_price_drop", {
    product_id: productId,
    new_price: price,
    ...(oldPrice ? { old_price: oldPrice } : {}),
    currency: String(body.currency ?? "USD"),
    source: "sample injection (demo)",
    lines_updated: applied.length,
    ...(affected.length ? { journeys: affected.map((j) => j.id) } : {}),
  });
  res.status(201).json({ ok: true, journaled: { seq: event.seq }, lines_updated: applied.length, journeys_affected: affected.length });
});

// --- Log in with PayPal (the REAL one) -----------------------------------------
// Connect with PayPal, OpenID Connect: authorize on paypal.com, exchange the
// code at the identity tokenservice, read the buyer at userinfo. The demo
// email login stays as the honest fallback (Connect needs the redirect URI
// registered on the app — developer dashboard, account-side).

const safeNext = (n: unknown): string =>
  typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/";

app.get("/api/auth/paypal/start", (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID || !paypal) {
    return res.redirect("/login?error=" + encodeURIComponent("PayPal login not configured (missing client credentials)"));
  }
  const state = randomBytes(16).toString("hex");
  oidcStates.set(state, safeNext((req.query as { next?: string }).next));
  persistWebSessions();
  const base = process.env.APP_BASE_URL ?? `${req.protocol}://${req.get("host")}`;
  const redirectUri = `${base}/api/auth/paypal/callback`;
  const envPrefix = process.env.PAYPAL_ENV === "live" ? "www" : "www.sandbox";
  const authorize = new URL("https://" + envPrefix + ".paypal.com/connect/");
  authorize.searchParams.set("client_id", process.env.PAYPAL_CLIENT_ID);
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  res.redirect(authorize.toString());
});

app.get("/api/auth/paypal/callback", async (req, res) => {
  const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
  const fail = (reason: string, detail: string) => {
    journal.append("paypal_login_failed", { reason, detail: detail.slice(0, 200) });
    return res.redirect("/login?error=" + encodeURIComponent(`paypal: ${reason}`));
  };
  // An OAuth callback must NEVER take the process down (Express 4 does not
  // catch async handler rejections — an uncaught throw here 502s on Render).
  // Any surprise becomes a redirect with the honest reason.
  try {
    const nextPath = q.state ? oidcStates.get(q.state) : undefined;
    if (q.error) return fail("denied", q.error_description ?? q.error);
    if (!q.code || !q.state || !oidcStates.delete(q.state)) {
      return fail("state", "unknown or expired state — the instance likely restarted between login and callback; retry the button");
    }
    if (!paypal) return fail("unconfigured", "no paypal client");
    const base = process.env.APP_BASE_URL ?? `${req.protocol}://${req.get("host")}`;
    const tok = await paypal.oidcTokenExchange({ code: q.code, redirectUri: `${base}/api/auth/paypal/callback` });
    const accessToken = tok.data?.access_token;
    if (!tok.ok || !accessToken) {
      return fail("exchange", `tokenservice ${tok.status}: usually the redirect URI is not registered on the app, or the Connect feature is not enabled (developer dashboard) — raw: ${JSON.stringify(tok.data ?? {}).slice(0, 120)}`);
    }
    const ui = await paypal.oidcUserinfo(accessToken);
    // Fallback: sandbox business accounts often have an EMPTY profile, and
    // PayPal's userinfo answers 400 "Unable to fetch details" for them. The
    // OIDC id_token from the same exchange carries the claims anyway.
    let claims: Record<string, unknown> = {};
    const idToken = (tok.data as { id_token?: string } | undefined)?.id_token;
    if (idToken) {
      try {
        claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      } catch { /* malformed id_token — userinfo result stands */ }
    }
    const src = ui.ok && Object.keys(ui.data ?? {}).length ? ui.data : claims;
    const payerId = String(src.payer_id ?? src.user_id ?? "");
    const email = typeof src.email === "string" ? src.email : "";
    const name = typeof src.name === "string" ? src.name : undefined;
    const givenName = typeof src.given_name === "string" ? src.given_name : undefined;
    if (!payerId && !email) {
      // PayPal sandbox limitation: userinfo refuses accounts with empty
      // profiles and no id_token is issued for the grant. The token exchange
      // itself SUCCEEDED (PayPal authenticated the account) — seat the
      // business session with a minimal, honestly-labeled identity rather
      // than locking the seller out of their own cockpit.
      const token = randomBytes(32).toString("hex");
      sessions.set(token, {
        sub: "paypal:business-session",
        expiresAt: Date.now() + SESSION_TTL_MS,
        profile: { accountType: "business", name: "PayPal business account (sandbox)" },
      });
      persistWebSessions();
      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
      );
      journal.append("paypal_login", {
        sub: "paypal:business-session",
        account_type: "business",
        oidc: true,
        note: "userinfo unavailable (sandbox empty-profile limitation) — minimal business seat",
      });
      return res.redirect(nextPath ?? "/");
    }
    const accountType =
      (typeof claims.account_type === "string" && claims.account_type.toUpperCase().includes("BUSINESS")) ? "business"
      : (typeof claims.account_type === "string" && claims.account_type.toUpperCase().includes("PERSONAL")) ? "personal"
      : email.includes("business.example") ? "business"
      : email.includes("personal.example") || email.includes("personal.sandbox") ? "personal"
      : "paypal";
    const sub = payerId ? `paypal:${payerId}` : `paypal:${email.split("@")[0]}`;
    const profile: AccountProfile = {
      ...(name ? { name } : {}),
      ...(givenName ? { givenName } : {}),
      ...(email ? { email } : {}),
      ...(payerId ? { payerId } : {}),
      accountType,
    };
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { sub, expiresAt: Date.now() + SESSION_TTL_MS, profile });
    persistWebSessions();
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    );
    // Minimization: the journal proves WHO logged in without archiving the email.
    journal.append("paypal_login", {
      sub,
      account_type: accountType,
      via: ui.ok && Object.keys(ui.data ?? {}).length ? "userinfo" : "id_token",
      email_domain: email.includes("@") ? email.split("@")[1] : undefined,
      name_given: typeof givenName === "string" ? givenName.slice(0, 40) : undefined,
      oidc: true,
    });
    return res.redirect(nextPath ?? "/");
  } catch (e) {
    return fail("internal", (e as Error).message);
  }
});

function formatForApi(minor: bigint, currency: string): string {
  const exp = currency === "JPY" ? 0 : 2;
  if (exp === 0) return minor.toString();
  const s = minor.toString().padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

// --- Dispute automation rules (PayPal has them; ours are coverage-aware) ------
app.get("/api/disputes/rules", (_req, res) => {
  res.json({ rules: disputeRules.list() });
});

app.post("/api/disputes/rules", (req, res) => {
  const b = (req.body ?? {}) as { name?: string; reasons?: string[]; maxAmount?: number; requireMandate?: boolean; action?: string; priority?: number };
  if (!b.name) return res.status(400).json({ error: "name is required" });
  const rule = disputeRules.create({
    name: String(b.name), reasons: Array.isArray(b.reasons) ? b.reasons : [],
    maxAmount: b.maxAmount !== undefined ? Number(b.maxAmount) : undefined,
    requireMandate: b.requireMandate !== false,
    action: b.action === "auto_reject" ? "auto_reject" : "auto_refund",
    priority: b.priority,
  });
  journal.append("dispute_rule_created", { rule_id: rule.id, name: rule.name, action: rule.action, reasons: rule.reasons });
  res.status(201).json(rule);
});

app.delete("/api/disputes/rules/:id", (req, res) => {
  res.json({ ok: disputeRules.remove(req.params.id) });
});

app.post("/api/disputes/rules/:id/toggle", (req, res) => {
  const active = Boolean((req.body as { active?: boolean } | undefined)?.active);
  const r = disputeRules.setActive(req.params.id, active);
  if (!r) return res.status(404).json({ error: "rule not found" });
  journal.append("dispute_rule_toggled", { rule_id: r.id, active });
  res.json(r);
});

// run every active rule against the current disputes; matched auto_refund rules
// settle through the REAL fast lane (PayPal refund, journalled), auto_reject just
// flags the case for manual submission. This is what PayPal's "Automatisez vos
// résolutions" does — with the coverage guard theirs lacks.
app.post("/api/disputes/rules/evaluate", async (_req, res) => {
  const actions: Array<Record<string, unknown>> = [];
  let disputes: any[] = [];
  try {
    disputes = (await disputes_service_list()) ?? [];
  } catch (e) {
    return res.status(502).json({ error: `disputes unavailable: ${(e as Error).message}` });
  }
  for (const d of disputes) {
    if (String(d.status ?? "").toUpperCase().includes("RESOLVED")) continue;
    const pack = buildEvidencePack(d, { enforcer, journal, store, keys });
    const facts = {
      hasLinkedReceipt: Boolean(pack.linkedPurchase),
      isRecurringMandate: false,
      hasFulfillment: Boolean(pack.fulfillment),
      ...(pack.refund?.refundId ? { refundId: pack.refund.refundId } : {}),
    };
    const m = disputeRules.match(d, facts);
    if (!m) continue;
    if (m.rule.action === "auto_refund") {
      if (rails.mode === "mock" || !paypal) {
        actions.push({ dispute: d.disputeId, rule: m.rule.name, action: "auto_refund", simulated: true, note: "mock rails — refund is a sandbox/live operation" });
        continue;
      }
      const captureId = pack.linkedPurchase?.receipt.captureId ?? d.disputedTransactions?.[0]?.transaction_id;
      if (!captureId) { actions.push({ dispute: d.disputeId, rule: m.rule.name, error: "no capture id" }); continue; }
      const rf = await paypal.refundCapture({
        captureId, amount: d.amount, currency: d.currency,
        note: `carte-blanche rule "${m.rule.name}": settled ${d.disputeId}`,
        requestId: `cb-rule-${m.rule.id}-${d.disputeId}`.slice(0, 64),
      });
      const refundId = (rf.data as { id?: string } | undefined)?.id ?? "";
      journal.append("dispute_rule_applied", {
        dispute_id: d.disputeId, rule_id: m.rule.id, rule_name: m.rule.name,
        action: "auto_refund", capture_id: captureId, ...(refundId ? { refund_id: refundId } : {}),
        amount: d.amount, currency: d.currency, ok: rf.ok, paypal_status: rf.status,
      });
      actions.push({ dispute: d.disputeId, rule: m.rule.name, action: "auto_refund", ok: rf.ok, refundId, paypalStatus: rf.status });
    } else {
      journal.append("dispute_rule_applied", { dispute_id: d.disputeId, rule_id: m.rule.id, rule_name: m.rule.name, action: "auto_reject" });
      actions.push({ dispute: d.disputeId, rule: m.rule.name, action: "auto_reject", note: "flagged for evidence submission" });
    }
  }
  res.json({ evaluated: disputes.length, actions });
});

async function disputes_service_list(): Promise<any[] | null> {
  try { return await disputes.list(); } catch { return null; }
}

// Agent-facing artifacts that live outside the Vite build
app.get("/llms.txt", (_req, res) => {
  res.sendFile(path.join(repoRoot, "src", "web", "llms.txt"));
});

// --- Agent passports: WHO is this agent (the identity layer, integrated) -----
// Register once (server-generated keypair returned ONCE, or bring your own
// public key), then sign every purchase with cb-agent-proof:<logicalKey>:<ts>.
// Receipts stamp the passport DID — proof of WHICH agent instance executed.
app.post("/api/agents/passport", (req, res) => {
  const b = (req.body ?? {}) as { agent_id?: string; public_key_b64?: string; owner?: string };
  const out = agentPassports.register({
    ...(b.agent_id ? { agentId: String(b.agent_id) } : {}),
    ...(b.public_key_b64 ? { publicKeyB64: String(b.public_key_b64) } : {}),
    ...(b.owner ? { owner: String(b.owner) } : {}),
  });
  journal.append("agent_passport_issued", {
    agent_id: out.passport.agentId, did: out.passport.did,
    fingerprint: out.passport.fingerprint,
    server_generated: !b.public_key_b64,
  });
  res.status(201).json({
    ...out,
    sign_template: "cb-agent-proof:<logical_key>:<ts>",
    note: "sign that string with the Ed25519 secret key and pass it as agent_proof on every purchase",
  });
});

app.get("/api/agents/passport/:agentId", (req, res) => {
  const p = agentPassports.get(req.params.agentId);
  if (!p) return res.status(404).json({ error: "passport not found" });
  res.json(p);
});

app.get("/api/agents/passports", (_req, res) => {
  res.json({ passports: agentPassports.list() });
});

// The sandbox account's REAL money view, straight from PayPal's Transaction
// Search: each transaction carries the balance AFTER it, so the latest one IS
// the account balance. Captures move it up, refunds move it down — the user
// watches the sandbox economy actually move.
app.get("/api/paypal/money", async (_req, res) => {
  if (rails.mode === "mock" || !paypal) {
    return res.status(409).json({ error: "mock rails: the sandbox balance is a PayPal-side view" });
  }
  try {
    const end = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const start = new Date(Date.now() - 31 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
    const res2 = await paypal.listTransactions(start, end);
    if (!res2.ok) return res.status(502).json({ error: `paypal transactions ${res2.status}` });
    const all = [...(res2.data?.transaction_details ?? [])].sort((a, b) =>
      String(a.transaction_info.transaction_initiation_date ?? "") < String(b.transaction_info.transaction_initiation_date ?? "") ? 1 : -1);
    const latest = all[0]?.transaction_info;
    const balance = latest?.available_balance ?? latest?.ending_balance ?? null;
    const rows = all.slice(0, 10).map((t) => {
      const ti = t.transaction_info;
      const value = Number.parseFloat(ti.transaction_amount?.value ?? "0");
      return {
        date: ti.transaction_initiation_date ?? "",
        subject: ti.transaction_subject || (value >= 0 ? "Money in" : "Money out"),
        amount: ti.transaction_amount?.value ?? "0",
        currency: ti.transaction_amount?.currency_code ?? "USD",
        status: ti.transaction_status ?? "",
        balanceAfter: ti.ending_balance?.value ?? null,
        agentMarker: typeof ti.custom_field === "string" && ti.custom_field.startsWith("cb|") ? ti.custom_field.split("|")[1] ?? null : null,
        transactionId: ti.transaction_id ?? "",
      };
    });
    res.json({
      balance: balance ? { value: balance.value, currency: balance.currency_code ?? "USD" } : null,
      transactions: rows,
      count: all.length,
      window: "last 31 days",
    });
  } catch (e) {
    res.status(502).json({ error: `paypal money view failed: ${(e as Error).message}` });
  }
});

// SPA fallback: the React app owns every app route (/, /planner, /oversight,
// /dashboard, /board, /verify/*, /docs, /login). API, vendor files and anything
// with an extension keep their normal handling above.
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api") || req.path.startsWith("/vendor")) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(webRoot, "index.html"));
});

app.listen(PORT, () => {
  console.log(`carte-blanche listening on http://localhost:${PORT} (rails: ${rails.mode})`);
});
