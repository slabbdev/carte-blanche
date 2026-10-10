import { PayPalClient, type PayPalEnv } from "./client.js";

export interface CreateOrderArgs {
  amount: string;
  currency: string;
  description?: string;
  payee?: string;
  /** Deterministic per-logical-operation id; a retry reuses the same value. */
  requestId: string;
}

export interface OrderResult {
  id: string;
  status: string;
}

export interface CaptureResult {
  orderId: string;
  captureId: string;
  status: string;
}

export type RailsMode = "mock" | "sandbox" | "live";

export interface PaymentRails {
  readonly mode: RailsMode;
  createOrder(args: CreateOrderArgs): Promise<OrderResult>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureResult>;
}

/**
 * In-memory simulator, clearly labeled: every id it returns is prefixed with
 * MOCK-. It exists so the mandate/enforcer/journal stack can run with zero
 * credentials; any output it produces is dev output, never presented as a
 * PayPal transaction.
 */
export class MockRails implements PaymentRails {
  readonly mode: RailsMode = "mock";
  createOrderCalls = 0;
  private counter = 0;
  private orders = new Map<string, { amount: string; currency: string }>();

  async createOrder(args: CreateOrderArgs): Promise<OrderResult> {
    this.createOrderCalls++;
    const id = `MOCK-${String(++this.counter).padStart(4, "0")}`;
    this.orders.set(id, { amount: args.amount, currency: args.currency });
    return { id, status: "CREATED" };
  }

  async captureOrder(orderId: string, _requestId: string): Promise<CaptureResult> {
    if (!this.orders.has(orderId)) throw new Error(`unknown mock order: ${orderId}`);
    return { orderId, captureId: `MOCK-CAP-${orderId}`, status: "COMPLETED" };
  }
}

/** Real PayPal REST rails (sandbox or live, per the client config). */
export class LiveRails implements PaymentRails {
  readonly mode: RailsMode;
  constructor(private readonly client: PayPalClient) {
    this.mode = client.env === "sandbox" ? "sandbox" : "live";
  }
  async createOrder(args: CreateOrderArgs): Promise<OrderResult> {
    const res = await this.client.createOrder(args);
    if (!res.ok) throw new Error(`PayPal createOrder failed (${res.status}): ${JSON.stringify(res.data)}`);
    return { id: res.data.id, status: res.data.status };
  }
  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    const res = await this.client.captureOrder(orderId, requestId);
    if (!res.ok) throw new Error(`PayPal captureOrder failed (${res.status}): ${JSON.stringify(res.data)}`);
    const capture = res.data.purchase_units?.[0]?.payments?.captures?.[0];
    return { orderId, captureId: capture?.id ?? "unknown", status: capture?.status ?? res.data.status };
  }
}

/** Builds the real PayPal client from env, or undefined in mock mode. */
export function makePayPalClient(env: Record<string, string | undefined>): PayPalClient | undefined {
  const mode = (env.PAYPAL_MODE ?? "mock") as RailsMode;
  if (mode === "mock") return undefined;
  const clientId = env.PAYPAL_CLIENT_ID;
  const clientSecret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required when PAYPAL_MODE is not 'mock'");
  }
  const paypalEnv: PayPalEnv = env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  return new PayPalClient({ env: paypalEnv, clientId, clientSecret });
}

export function makeRails(env: Record<string, string | undefined>): PaymentRails {
  const mode = (env.PAYPAL_MODE ?? "mock") as RailsMode;
  if (mode === "mock") return new MockRails();
  return new LiveRails(makePayPalClient(env)!);
}
