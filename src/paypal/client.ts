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
      "User-Agent": "carte-blanche/0.1.0",
    };
    if (requestId !== undefined) headers["PayPal-Request-Id"] = requestId;
    const res = await this.fetchImpl(`${HOSTS[this.cfg.env]}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return { status: res.status, ok: res.ok, data };
  }

  async createOrder(args: {
    amount: string;
    currency: string;
    description?: string;
    payee?: string;
    requestId: string;
  }): Promise<PayPalResponse<OrderBody>> {
    const unit: Record<string, unknown> = {
      amount: { currency_code: args.currency, value: args.amount },
    };
    if (args.description) unit.description = args.description.slice(0, 127);
    if (args.payee) unit.payee = { email_address: args.payee };
    return this.request<OrderBody>(
      "POST",
      "/v2/checkout/orders",
      { intent: "CAPTURE", purchase_units: [unit] },
      args.requestId,
    );
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
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
