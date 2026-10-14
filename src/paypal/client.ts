/**
 * Thin PayPal REST client (Orders v2, Customer Disputes v1). Deliberately not
 * the agent-toolkit: the whole point of Carte Blanche is to sit between the
 * agent and PayPal, so we need full control of every request — especially the
 * `PayPal-Request-Id` header, which the official toolkit sets at client level
 * instead of per call (its issue #98: an agent-framework retry then double
 * creates orders). Here every logical operation derives a deterministic
 * request id, so a retry can never produce a second side effect.
 */
export type PayPalEnv = "sandbox" | "live";

export interface PayPalClientConfig {
  env: PayPalEnv;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

const HOSTS: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export interface PayPalResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface OrderBody {
  id: string;
  status: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{ id: string; status: string }>;
    };
  }>;
}

export class PayPalClient {
  private token: { value: string; expiresAt: number } | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: PayPalClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  get env(): PayPalEnv {
    return this.cfg.env;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    const res = await this.fetchImpl(`${HOSTS[this.cfg.env]}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`PayPal OAuth failed (${res.status}): ${await safeText(res)}`);
    }
    const data = (await res.json()) as TokenResponse;
    this.token = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return this.token.value;
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    requestId: string | undefined,
  ): Promise<PayPalResponse<T>> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "carte-blanche/0.2.0",
    };
    if (requestId !== undefined) headers["PayPal-Request-Id"] = requestId;
    const res = await this.fetchImpl(`${HOSTS[this.cfg.env]}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = res.status === 204 ? "" : await res.text();
    const data = (raw.trim() ? (JSON.parse(raw) as T) : (undefined as T));
    return { status: res.status, ok: res.ok, data };
  }

  async createOrder(args: {
    amount: string;
    currency: string;
    description?: string;
    payee?: string;
    /**
     * Route funds to the payee account (unit.payee) — the default — or record
     * the enforced payee as order metadata (custom_id) instead. Sandbox
     * card-funded orders reject payee routing outright
     * (PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING), so on those rails the payee
     * travels as reconcilable metadata rather than a funds-routing instruction.
     */
    payeeAsMetadata?: boolean;
    /** Agent-purchase marker written onto PayPal's own order record. */
    customId?: string;
    requestId: string;
    /** Raw payment_source (e.g. sandbox test card) — passed through verbatim. */
    paymentSource?: Record<string, unknown>;
  }): Promise<PayPalResponse<OrderBody>> {
    const unit: Record<string, unknown> = {
      amount: { currency_code: args.currency, value: args.amount },
    };
    if (args.description) unit.description = args.description.slice(0, 127);
    if (args.customId) unit.custom_id = args.customId.slice(0, 127);
    if (args.payee && !args.payeeAsMetadata) {
      unit.payee = { email_address: args.payee };
    }
    const body: Record<string, unknown> = { intent: "CAPTURE", purchase_units: [unit] };
    if (args.paymentSource) body.payment_source = args.paymentSource;
    return this.request<OrderBody>("POST", "/v2/checkout/orders", body, args.requestId);
  }

  async captureOrder(orderId: string, requestId: string): Promise<PayPalResponse<OrderBody>> {
    return this.request<OrderBody>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, undefined, requestId);
  }

  async getOrder(orderId: string): Promise<PayPalResponse<OrderBody>> {
    return this.request<OrderBody>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, undefined, undefined);
  }

  async listDisputes(): Promise<PayPalResponse<{ links?: unknown[]; items?: Array<{ dispute_id: string; status: string; reason: string }> }>> {
    return this.request("GET", "/v1/customer/disputes", undefined, undefined);
  }

  /**
   * Verify a webhook transmission against PayPal's certificate chain.
   * Returns true only when PayPal itself says the signature is genuine —
   * this is what makes a webhook a PayPal-CONFIRMED event rather than a
   * self-reported one.
   */
  async verifyWebhookSignature(event: Record<string, unknown>, headers: Record<string, string>, webhookId: string): Promise<boolean> {
    const res = await this.request("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: event,
    }, undefined);
    return res.ok && (res.data as { verification_status?: string })?.verification_status === "SUCCESS";
  }

  /**
   * Transaction Search (v1/reporting/transactions): PayPal's own record of
   * captured transactions. Each entry carries `custom_field` — the custom_id
   * we stamped at order creation — which is how agent purchases become
   * DETECTABLE on PayPal's side without PayPal changing anything.
   */
  async listTransactions(start: string, end: string): Promise<PayPalResponse<{
    transaction_details?: Array<{
      transaction_info: {
        transaction_id?: string;
        transaction_status?: string;
        transaction_amount?: { currency_code?: string; value?: string };
        custom_field?: string;
        transaction_initiation_date?: string;
      };
    }>;
  }>> {
    const qs = new URLSearchParams({ start_date: start, end_date: end, fields: "all", page_size: "100" });
    return this.request("GET", `/v1/reporting/transactions?${qs.toString()}`, undefined, undefined);
  }

  async getDispute(disputeId: string): Promise<PayPalResponse<Record<string, unknown>>> {
    return this.request("GET", `/v1/customer/disputes/${encodeURIComponent(disputeId)}`, undefined, undefined);
  }

  /**
   * Sandbox helper: creates a SAMPLE dispute so the dispute flow can be
   * exercised without a real buyer complaint. Documented as sandbox-only
   * ("mode": "SAMPLE_DISPUTE"); on live this endpoint is not for sellers.
   */
  async createSampleDispute(args: {
    transactionId: string;
    reason: string;
    note?: string;
  }): Promise<PayPalResponse<Record<string, unknown>>> {
    return this.request("POST", "/v1/customer/disputes", {
      mode: "SAMPLE_DISPUTE",
      reason: args.reason,
      disputed_transaction: {
        transaction_id: args.transactionId,
        note: args.note ?? "carte-blanche sample dispute (sandbox)",
      },
    }, undefined);
  }

  /**
   * Sandbox helper: files a dispute with an explicit raw body — probe surface
   * for finding the create-dispute shape the sandbox actually accepts.
   */
  async createSampleDisputeBody(body: Record<string, unknown>): Promise<PayPalResponse<Record<string, unknown>>> {
    return this.request("POST", "/v1/customer/disputes", body, undefined);
  }

  /**
   * Merchant response to a dispute: evidence submission. `evidence` follows
   * the provide-evidence schema (evidence_type + notes + optional
   * return_shipping_info / evidence_info). Files are NOT uploaded here — the
   * documents download scope requires an account manager; packs go as notes
   * plus structured JSON.
   */
  async provideEvidence(disputeId: string, evidence: Array<Record<string, unknown>>, notes?: string): Promise<PayPalResponse<Record<string, unknown>>> {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
      evidence,
      ...(notes ? { notes } : {}),
    }, undefined);
  }

  /** INQUIRY-stage counterpart of provide-evidence (PP-R cases). */
  async sendEvidence(disputeId: string, evidence: Array<Record<string, unknown>>, notes?: string): Promise<PayPalResponse<Record<string, unknown>>> {
    return this.request("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-evidence`, {
      evidence,
      ...(notes ? { notes } : {}),
    }, undefined);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
