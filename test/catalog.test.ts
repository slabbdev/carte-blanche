import { describe, expect, it } from "vitest";
import { Channel3Catalog, sampleProducts } from "../src/catalog/channel3.js";

describe("Channel3 catalog", () => {
  it("maps a real search response into catalog products", async () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Merino Sweater",
          description: "100% wool",
          offers: [{ price: 79.9, currency: "USD", website: { name: "Retailer" } }],
          images: [{ url: "http://x/1.jpg", is_main_image: true }],
        },
      ],
    };
    const client = new Channel3Catalog("key", {
      async post() {
        return { status: 200, json: raw };
      },
    });
    const res = await client.search("merino sweater");
    expect(res.source).toBe("channel3");
    expect(res.products[0].price).toBe("79.90");
    expect(res.products[0].currency).toBe("USD");
    expect(res.products[0].image).toBe("http://x/1.jpg");
    expect(res.products[0].website).toBe("Retailer");
  });

  it("prefers the cleaned image for grids when present", async () => {
    const raw = {
      products: [
        {
          id: "p2",
          title: "Desk Lamp",
          offers: [{ price: 39 }],
          images: [{ url: "http://x/hero.jpg" }, { cleaned_url: "http://x/clean.jpg", is_main_image: false }],
        },
      ],
    };
    const client = new Channel3Catalog("key", { async post() { return { status: 200, json: raw }; } });
    const res = await client.search("lamp");
    expect(res.products[0].image).toBe("http://x/clean.jpg");
  });

  it("falls back to labeled samples on API failure — and says why", async () => {
    const client = new Channel3Catalog("key", { async post() { return { status: 429, json: {} }; } });
    const res = await client.search("sweater");
    expect(res.source).toBe("sample");
    expect(res.error).toMatch(/http 429/);
    expect(res.products.length).toBeGreaterThan(0);
    expect(res.products.every((p) => p.title.startsWith("Sample:"))).toBe(true);
  });

  it("never hits the network without a key", async () => {
    const client = new Channel3Catalog(undefined, {
      async post() {
        throw new Error("should not be called");
      },
    });
    const res = await client.search("");
    expect(res.source).toBe("sample");
    expect(res.error).toBeUndefined();
    expect(res.products.length).toBeGreaterThan(0);
  });

  it("scores sample products against the query", () => {
    expect(sampleProducts("keyboard")[0].id).toBe("sample-keyboard-1");
    expect(sampleProducts("coffee beans")[0].id).toBe("sample-coffee-1");
  });
});
