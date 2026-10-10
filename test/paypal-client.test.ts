import { describe, expect, it, vi } from "vitest";
import { PayPalClient } from "../src/paypal/client.js";

type Call = { url: string; init: RequestInit };

function fetchMock(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, impl };
}

const TOKEN = { access_token: "tok-1", expires_in: 3600 };

describe("PayPalClient", () => {
  it("sends a deterministic PayPal-Request-Id and caches the OAuth token", async () => {
    const { calls, impl } = fetchMock([
      { status: 200, body: TOKEN },
      { status: 201, body: { id: "ORDER-1", status: "CREATED" } },
      { status: 201, body: { id: "ORDER-1", status: "CREATED" } },
    ]);
    const client = new PayPalClient({ env: "sandbox", clientId: "cid", clientSecret: "sec", fetchImpl: impl });

    const args = { amount: "25.00", currency: "USD", requestId: "cb-fixed-create" };
    await client.createOrder(args);
    await client.createOrder(args);

    const tokenCalls = calls.filter((c) => c.url.includes("/v1/oauth2/token"));
    expect(tokenCalls).toHaveLength(1); // token cached across calls

    const orderCalls = calls.filter((c) => c.url.includes("/v2/checkout/orders"));
    expect(orderCalls).toHaveLength(2);
    for (const c of orderCalls) {
      const headers = c.init.headers as Record<string, string>;
      expect(headers["PayPal-Request-Id"]).toBe("cb-fixed-create");
      expect(headers["Authorization"]).toBe("Bearer tok-1");
    }
    expect(orderCalls[0].url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
  });

  it("parses the capture id from a capture response", async () => {
    const { calls, impl } = fetchMock([
      { status: 200, body: TOKEN },
      {
        status: 201,
        body: {
          id: "ORDER-9",
          status: "COMPLETED",
          purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "COMPLETED" }] } }],
        },
      },
    ]);
    const client = new PayPalClient({ env: "sandbox", clientId: "cid", clientSecret: "sec", fetchImpl: impl });
    const res = await client.captureOrder("ORDER-9", "cb-x-cp");
    expect(res.ok).toBe(true);
    expect(res.data.purchase_units?.[0]?.payments?.captures?.[0]?.id).toBe("CAP-1");
    expect(vi.isMockFunction(impl)).toBe(false); // sanity: real fetch-shaped stub
    expect(calls[1].init.method).toBe("POST");
  });

  it("targets the live host only when asked to", async () => {
    const { calls, impl } = fetchMock([
      { status: 200, body: TOKEN },
      { status: 200, body: { id: "O", status: "CREATED" } },
    ]);
    const client = new PayPalClient({ env: "live", clientId: "cid", clientSecret: "sec", fetchImpl: impl });
    await client.getOrder("O");
    expect(calls[1].url).toBe("https://api-m.paypal.com/v2/checkout/orders/O");
  });
});
