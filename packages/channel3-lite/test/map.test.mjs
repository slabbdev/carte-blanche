import { test } from "node:test";
import assert from "node:assert/strict";
import { mapProduct } from "../dist/index.js";

test("maps the real Channel3 shape: price objects, domain merchants, affiliate links", () => {
  const p = mapProduct({
    id: "01M0",
    title: "Keychron K2 mechanical keyboard",
    currency: "USD",
    ratings: { value: 4.6, count: 214 },
    images: [
      { url: "https://img.example/hero.jpg", is_main_image: true },
      { url: "https://img.example/a.jpg", cleaned_url: "https://img.example/a-clean.jpg" },
    ],
    offers: [
      { domain: "keychron.com", price: { price: 79.0, currency: "USD", compare_at_price: 99.0 }, url: "https://buy.trychannel3.com/x?o=1" },
      { domain: "amazon.com", price: { price: "74.99", currency: "USD" }, url: "https://buy.trychannel3.com/x?o=2" },
    ],
  });
  assert.ok(p);
  // cheapest first, price as decimal string
  assert.equal(p.price, "74.99");
  assert.equal(p.offers[0].merchant, "amazon.com");
  assert.equal(p.offers[1].price, "79.00");
  // affiliate link is the buyUrl
  assert.equal(p.offers[0].buyUrl, "https://buy.trychannel3.com/x?o=2");
  // cleaned image preferred over the hero shot
  assert.equal(p.image, "https://img.example/a-clean.jpg");
  assert.equal(p.rating, 4.6);
  assert.equal(p.ratingCount, 214);
});

test("tolerates the messy variants: bare-number prices, website.name merchants, missing fields", () => {
  const p = mapProduct({
    id: "x1",
    title: "Mystery gadget",
    price: 12.5,
    currency: "USD",
    offers: [
      { price: 9, currency: "USD", website: { name: "TinyShop" } },
      { price: null },
      { domain: "bigstore.com" },
    ],
  });
  assert.ok(p);
  assert.equal(p.price, "9.00");
  assert.equal(p.offers.length, 1);
  assert.equal(p.offers[0].merchant, "TinyShop");
});

test("returns undefined for unusable products (no id or no title)", () => {
  assert.equal(mapProduct({ title: "no id" }), undefined);
  assert.equal(mapProduct({ id: "no title" }), undefined);
});
