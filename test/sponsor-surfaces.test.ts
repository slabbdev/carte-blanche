import { describe, expect, it } from "vitest";
import { PayPalClient } from "../src/paypal/client.js";
import { Channel3Catalog, parsePriceWebhook } from "../src/catalog/channel3.js";

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

describe("PayPal shipment trackers (the bilateral fulfillment slot)", () => {
  it("posts the tracker against the capture with carrier + tracking", async () => {
    const { calls, impl } = fetchMock([
      { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { status: 201, body: { tracker_id: "8XA123", status: "SHIPPED" } },
    ]);
    const client = new PayPalClient({ env: "sandbox", clientId: "cid", clientSecret: "sec", fetchImpl: impl });
    const res = await client.createTracker({ captureId: "CAP-1", trackingNumber: "6A12345678901", carrier: "LA_POSTE" });

    expect(res.ok).toBe(true);
    const call = calls.find((c) => c.url.includes("/v1/shipping/trackers"))!;
    expect(call).toBeDefined();
    expect(call.init.method).toBe("POST");
    const body = JSON.parse(String(call.init.body));
    // their v1 schema: transaction_id (the capture id serves) + status required,
    // carrier from PayPal's supported list — verified against a live 400
    expect(body.trackers[0]).toEqual({
      transaction_id: "CAP-1",
      tracking_number: "6A12345678901",
      carrier: "LA_POSTE",
      status: "SHIPPED",
    });
  });
});

describe("Log in with PayPal (OIDC)", () => {
  it("exchanges the code with Basic client auth and reads the profile", async () => {
    const { calls, impl } = fetchMock([
      { status: 200, body: { access_token: "oidc-tok" } },
      { status: 200, body: { payer_id: "PX1", email: "buyer@example.com", given_name: "Sam" } },
    ]);
    const client = new PayPalClient({ env: "sandbox", clientId: "cid", clientSecret: "sec", fetchImpl: impl });

    const tok = await client.oidcTokenExchange({ code: "abc", redirectUri: "https://app/cb" });
    expect(tok.ok).toBe(true);
    const ex = calls.find((c) => c.url.includes("/v1/identity/openidconnect/tokenservice"))!;
    expect(ex).toBeDefined();
    // Basic client credentials, NOT the app's bearer token — the classic Connect flow
    expect((ex.init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(String(ex.init.body)).toContain("grant_type=authorization_code");
    expect(String(ex.init.body)).toContain("redirect_uri=https%3A%2F%2Fapp%2Fcb");

    const ui = await client.oidcUserinfo(tok.data!.access_token!);
    expect(ui.ok).toBe(true);
    expect(calls.find((c) => c.url.includes("/v1/identity/oauth2/userinfo"))).toBeDefined();
    expect(ui.data.payer_id).toBe("PX1");
  });
});

describe("Channel3 price tracking (v0 shapes, verified from their docs)", () => {
  function transportMock() {
    const posts: Array<{ url: string; body: unknown }> = [];
    const gets: string[] = [];
    return {
      posts,
      gets,
      transport: {
        async post(url: string, body: unknown) {
          posts.push({ url, body });
          return { status: 200, json: {} };
        },
        async get(url: string) {
          gets.push(url);
          if (url.includes("/history/")) return { status: 200, json: { price_history: [{ timestamp: "2026-10-15T00:00:00Z", price: 17.0, currency: "USD" }] } };
          return { status: 200, json: { subscriptions: [{ canonical_product_id: "p1" }] } };
        },
      },
    };
  }

  it("starts, stops, lists and reads history on the v0 endpoints", async () => {
    const t = transportMock();
    const c3 = new Channel3Catalog("key", t.transport);

    await c3.startPriceTracking("p1");
    expect(t.posts[0].url).toBe("https://api.trychannel3.com/v0/price-tracking/start");
    expect(t.posts[0].body).toEqual({ canonical_product_id: "p1" });

    await c3.stopPriceTracking("p1");
    expect(t.posts[1].url).toBe("https://api.trychannel3.com/v0/price-tracking/stop");

    const subs = await c3.listPriceSubscriptions();
    expect(subs?.[0].canonical_product_id).toBe("p1");

    const hist = await c3.priceHistory("p1");
    expect(hist?.[0].price).toBe(17.0);
  });

  it("parses the documented price.changed webhook and ignores strangers", () => {
    const drop = parsePriceWebhook({ type: "price.changed", data: { canonical_product_id: "p1", new_price: 17, currency: "USD", old_price: 24 } });
    expect(drop).toEqual({ kind: "price.changed", productId: "p1", newPrice: "17.00", currency: "USD", oldPrice: "24.00" });

    const ignored = parsePriceWebhook({ type: "something.else" });
    expect(ignored.kind).toBe("ignored");
    const missing = parsePriceWebhook({ type: "price.changed", data: {} });
    expect(missing.kind).toBe("ignored");
  });
});
