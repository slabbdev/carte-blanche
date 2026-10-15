# channel3-lite

Dependency-free client for the **Channel3 shopping API** (`api.trychannel3.com`) —
100M+ retail offers with per-merchant price comparison. Extracted from the
[Carte Blanche](https://github.com/slabbdev/carte-blanche) project (PayPal AI
Hackathon 2026), where it feeds shopping agents real products and prices.

## Why "lite"

The Channel3 response shape has sharp edges that every integrator rediscovers
the hard way. This package maps them **once**, verified against the live API
(2026-10-14):

| Reality of the API | What this package does |
|---|---|
| Offer `price` is an **object** `{ price, currency, compare_at_price }` — sometimes a bare number/string | both normalized to a decimal string (`"74.99"`) |
| The merchant is a bare **domain** (`"keychron.com"`), or `website.name` on some rows | surfaced as `offer.merchant` |
| Every offer carries an affiliate `url` (`buy.trychannel3.com`) — that IS the monetization | surfaced as `offer.buyUrl` |
| `ratings: { value, count }` | surfaced as `product.rating` / `ratingCount` |
| Images: `cleaned_url` is grid-ready, the raw `url` is often a hero banner | `cleaned_url` preferred automatically |
| Pagination by opaque `next_page_token` | pass it back: `search(q, limit, token)` |

Offers come back **cheapest-first**, so "buy the cheapest authorized offer" is
`offers[0]` instead of a sorting policy.

## Usage

```ts
import { Channel3 } from "./dist/index.js";

const c3 = new Channel3(process.env.CHANNEL3_API_KEY!);

const res = await c3.search("mechanical keyboard", 6);
for (const p of res.products) {
  console.log(p.title, p.price, p.currency, "←", p.offers[0]?.merchant);
  // page through everything:
  // const next = await c3.search("mechanical keyboard", 6, res.nextPageToken);
}

// or resolve any retailer URL into a structured product:
const product = await c3.lookupByUrl("https://www.keychron.com/products/keychron-k2-he");
```

The transport is injectable (`new Channel3(key, { transport })`) for tests and
proxies. Zero runtime dependencies; needs Node ≥ 20 (global `fetch`).

## Build & test

```bash
npm run build
npm test
```

## Provenance & scope

Extracted verbatim from `src/catalog/channel3.ts` of the Carte Blanche repo,
minus the app-specific pieces (labeled offline samples, env-var defaults). The
hardened app version additionally falls back to sample products when the API
is unreachable — an agent's shopping scene should never die because a sponsor
API hiccuped.

License: MIT.
