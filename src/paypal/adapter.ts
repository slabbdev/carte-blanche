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

/**
 * Real PayPal REST rails (sandbox or live, per the client config).
 *
 * In SANDBOX mode, captures need a funding instrument; buyers normally
 * approve via redirect, which an agent middleware can't do. PayPal's own
 * answer for this is their documented sandbox test card, so sandbox rails
 * fund orders with it (env PAYPAL_SANDBOX_FUNDING=none disables). Live mode
 * never injects anything: a live merchant wires real approval flows.
 */
export class LiveRails implements PaymentRails {
  readonly mode: RailsMode;
  constructor(
    private readonly client: PayPalClient,
    private readonly sandboxFunding: boolean = false,
    private readonly env: Record<string, string | undefined> = {},
  ) {
    this.mode = client.env === "sandbox" ? "sandbox" : "live";
  }
  async createOrder(args: CreateOrderArgs): Promise<OrderResult> {
    const paymentSource = this.sandboxFunding ? sandboxTestCard(this.env) : undefined;
    const res = await this.client.createOrder({ ...args, paymentSource });
    if (!res.ok) throw new Error(`PayPal createOrder failed (${res.status}): ${JSON.stringify(res.data).slice(0, 400)}`);
    return { id: res.data.id, status: res.data.status };
  }
  async captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
    const res = await this.client.captureOrder(orderId, requestId);
    if (res.ok) {
      const capture = res.data.purchase_units?.[0]?.payments?.captures?.[0];
      return { orderId, captureId: capture?.id ?? "unknown", status: capture?.status ?? res.data.status };
    }
    // Sandbox card flows can auto-capture at order creation. Instead of
    // crashing on ORDER_ALREADY_CAPTURED (the classic double-spend trap),
    // reconcile with PayPal's real state and return the actual capture.
    const name = (res.data as { name?: string }).name;
    const already = (res.data as { details?: Array<{ issue?: string }> }).details?.some(
      (d) => d.issue === "ORDER_ALREADY_CAPTURED",
    );
    if (name === "UNPROCESSABLE_ENTITY" && already) {
      const order = await this.client.getOrder(orderId);
      if (!order.ok) throw new Error(`PayPal getOrder failed while reconciling: ${JSON.stringify(order.data).slice(0, 200)}`);
      const capture = order.data.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture) throw new Error(`order ${orderId} reports captured but carries no capture`);
      return { orderId, captureId: capture.id, status: capture.status };
    }
    throw new Error(`PayPal captureOrder failed (${res.status}): ${JSON.stringify(res.data).slice(0, 400)}`);
  }
}

/** PayPal sandbox test card (funds orders without buyer approval) — number overridable via env. */
export function sandboxTestCard(env: Record<string, string | undefined> = {}): Record<string, unknown> {
  const number = env.PAYPAL_SANDBOX_CARD_NUMBER ?? "4111111111111111";
  return {
    card: {
      number,
      expiry: "2030-12",
      cvv: "123",
      name: "John Dough",
      billing_address: {
        address_line_1: "1 Main St",
        admin_area_2: "San Jose",
        postal_code: "95131",
        country_code: "US",
      },
    },
  };
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
  const client = makePayPalClient(env)!;
  const sandboxFunding = client.env === "sandbox" && env.PAYPAL_SANDBOX_FUNDING !== "none";
  return new LiveRails(client, sandboxFunding, env);
}
