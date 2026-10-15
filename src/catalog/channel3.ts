/**
 * Channel3 sponsor integration: real product search across 100M+ retail
 * offers, feeding the agent's shopping scene with actual products and prices.
 * The client is optional by design — without an API key the catalog service
 * falls back to clearly-labeled sample products, so the demo never dies.
 */

export interface CatalogOffer {
  /** Decimal string, e.g. "74.50". */
  price: string;
  currency: string;
  /** Merchant / retailer domain (e.g. "keychron.com") when the API provides it. */
  merchant?: string;
  /** Affiliate buy link for this offer (buy.trychannel3.com). */
  buyUrl?: string;
  /** Commission rate on this offer (e.g. 0.02 = 2%) — Channel3 monetization. */
  commissionRate?: number;
}

export interface CatalogProduct {
  id: string;
  title: string;
  description?: string;
  /** Decimal string, e.g. "49.99" — the cheapest known offer, the price the mandate will pin. */
  price?: string;
  currency: string;
  image?: string;
  website?: string;
  /** Aggregate rating when the API provides it. */
  rating?: number;
  ratingCount?: number;
  /** Every known merchant offer, cheapest first — the price-comparison lens (drift story fuel). */
  offers: CatalogOffer[];
}

export interface CatalogResult {
  source: "channel3" | "sample";
  products: CatalogProduct[];
  /** Channel3 pagination cursor — pass back to search() for the next page. */
  nextPageToken?: string;
  error?: string;
}

export interface CatalogTransport {
  post(url: string, body: unknown, apiKey: string, timeoutMs: number): Promise<{ status: number; json: unknown }>;
  get?(url: string, apiKey: string, timeoutMs: number): Promise<{ status: number; json: unknown }>;
}

export const catalogHttpTransport: CatalogTransport = {
  async post(url, body, apiKey, timeoutMs) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, json };
  },
  async get(url, apiKey, timeoutMs) {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, json };
  },
};

/** A real search-response offer (verified against api.trychannel3.com, 2026-10-14):
 *  price is an object, the merchant is a domain, and each offer carries an
 *  affiliate buy link. */
interface RawOffer {
  url?: string;
  domain?: string;
  price?:
    | { price?: number | string | null; currency?: string | null; compare_at_price?: number | string | null }
    | number
    | string
    | null;
  currency?: string;
  availability?: string;
  website?: { name?: string } | null;
}

interface RawProduct {
  id?: string;
  title?: string;
  description?: string | null;
  offers?: RawOffer[] | null;
  price?: number | string | null;
  currency?: string | null;
  website?: { name?: string } | null;
  ratings?: { value?: number; count?: number } | null;
  images?: Array<{ url?: string; cleaned_url?: string | null; is_main_image?: boolean }> | null;
}

function formatPrice(raw: number | string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n.toFixed(2);
}

/** Offers carry the price either as an object ({price, currency}) or bare. */
function offerPrice(o: RawOffer): { price?: string; currency?: string } {
  if (o.price && typeof o.price === "object") {
    return { price: formatPrice(o.price.price), currency: o.price.currency ?? undefined };
  }
  return { price: formatPrice(o.price), currency: o.currency ?? undefined };
}

function mapProduct(raw: RawProduct): CatalogProduct | undefined {
  if (!raw?.id || !raw.title) return undefined;
  const offers: CatalogOffer[] = (raw.offers ?? [])
    .map((o) => {
      const { price, currency } = offerPrice(o);
      if (!price) return undefined;
      return {
        price,
        currency: currency ?? raw.currency ?? "USD",
        ...(o.domain ? { merchant: o.domain } : o.website?.name ? { merchant: o.website.name } : {}),
        ...(o.url ? { buyUrl: o.url } : {}),
      } as CatalogOffer;
    })
    .filter((o): o is CatalogOffer => Boolean(o))
    .sort((a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price));
  const best = offers[0];
  const images = raw.images ?? [];
  // Docs: prefer cleaned_url for grids — any cleaned image beats the hero shot.
  const main = images.find((i) => i.cleaned_url) ?? images.find((i) => i.is_main_image) ?? images[0];
  return {
    id: raw.id,
    title: raw.title,
    ...(raw.description ? { description: raw.description } : {}),
    ...(best ? { price: best.price } : formatPrice(raw.price) ? { price: formatPrice(raw.price) as string } : {}),
    currency: best?.currency ?? raw.currency ?? "USD",
    image: main?.cleaned_url ?? main?.url ?? undefined,
    website: best?.merchant ?? raw.website?.name ?? undefined,
    ...(raw.ratings?.value !== undefined && raw.ratings.value !== null
      ? { rating: raw.ratings.value, ratingCount: raw.ratings.count ?? undefined }
      : {}),
    offers,
  };
}

const GROUP_STOP = new Set([
  "console", "ssd", "hdd", "in", "with", "all", "digital", "robot", "edition", "bundle", "kit",
  "core", "black", "white", "blue", "red", "green", "nova", "pink",
]);

/**
 * Group near-identical listings so merchants compete on ONE card — "cheapest"
 * only means something when there is a contest. Conservative by design: the
 * group key is the title minus storage sizes, colorways and generic filler
 * ("xbox series x"), so a Series S never merges with a Series X, but "Series
 * X", "Series X 1TB SSD" and "Series X 1TB Console in Black" do. The shortest
 * title wins (it is usually the cleanest), the cheapest offer pins the price.
 */
export function groupSimilar(products: CatalogProduct[]): CatalogProduct[] {
  const keyOf = (t: string) =>
    t.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !/^\d+(\.\d+)?(tb|gb|mb)$/.test(w) && !GROUP_STOP.has(w))
      .join(" ");
  const groups = new Map<string, CatalogProduct>();
  const out: CatalogProduct[] = [];
  for (const p of products) {
    const key = keyOf(p.title);
    const g = groups.get(key);
    if (!g) {
      const copy = { ...p, offers: [...p.offers] };
      groups.set(key, copy);
      out.push(copy);
      continue;
    }
    for (const o of p.offers) {
      if (!g.offers.some((x) => x.merchant === o.merchant && x.price === o.price)) g.offers.push(o);
    }
    g.offers.sort((a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price));
    const best = g.offers[0];
    if (best) {
      g.price = best.price;
      g.currency = best.currency;
      g.website = best.merchant ?? g.website;
    }
    g.image = g.image ?? p.image;
    g.rating = g.rating ?? p.rating;
    g.ratingCount = g.ratingCount ?? p.ratingCount;
    if (p.title.length < g.title.length) g.title = p.title;
  }
  return out;
}

export class Channel3Catalog {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly transport: CatalogTransport = catalogHttpTransport,
    private readonly baseUrl = process.env.CHANNEL3_URL ?? "https://api.trychannel3.com",
    private readonly timeoutMs = 12_000,
  ) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /** URL lookup: pass any retailer product URL, get the structured product back. */
  async lookupByUrl(url: string): Promise<CatalogProduct | undefined> {
    if (!this.enabled) return undefined;
    try {
      const { status, json } = await this.transport.post(
        `${this.baseUrl}/v1/lookup`,
        { url },
        this.apiKey as string,
        this.timeoutMs,
      );
      if (status !== 200) return undefined;
      const raw = (json as { product?: RawProduct }).product ?? (json as unknown as RawProduct);
      return mapProduct(raw);
    } catch {
      return undefined;
    }
  }

  async search(query: string, limit = 6, pageToken?: string): Promise<CatalogResult> {
    if (!this.enabled) return { source: "sample", products: sampleProducts(query, pageToken) };
    try {
      const { status, json } = await this.transport.post(
        `${this.baseUrl}/v1/search`,
        { query, limit, ...(pageToken ? { page_token: pageToken } : {}) },
        this.apiKey as string,
        this.timeoutMs,
      );
      if (status !== 200) {
        return { source: "sample", products: sampleProducts(query, pageToken), error: `channel3 http ${status}` };
      }
      const products = groupSimilar(
        (Array.isArray((json as { products?: RawProduct[] }).products) ? (json as { products: RawProduct[] }).products : [])
          .map(mapProduct)
          .filter((p): p is CatalogProduct => Boolean(p)),
      );
      const next = (json as { next_page_token?: string }).next_page_token;
      return { source: "channel3", products, ...(next ? { nextPageToken: next } : {}) };
    } catch (err) {
      // The shopping scene must keep working offline — say what happened, fall back.
      return { source: "sample", products: sampleProducts(query, pageToken), error: (err as Error).message };
    }
  }

  // --- Price tracking (v0) — "time-to-buy" for standing baskets ---------------
  // Verified shapes from docs.trychannel3.com (2026-10-15). Webhooks are
  // configured in THEIR dashboard (account-side) and arrive as
  // {type: "price.changed", data: {canonical_product_id, new_price, currency}};
  // their docs document no signature scheme, so receivers journal honestly.

  /** Subscribe to price-change webhooks for a canonical product. */
  async startPriceTracking(canonicalProductId: string): Promise<{ ok: boolean; status: number; detail?: string }> {
    if (!this.enabled) return { ok: false, status: 0, detail: "channel3 disabled (no api key)" };
    try {
      const { status, json } = await this.transport.post(
        `${this.baseUrl}/v0/price-tracking/start`,
        { canonical_product_id: canonicalProductId },
        this.apiKey as string,
        this.timeoutMs,
      );
      return { ok: status === 200 || status === 201, status, ...(status >= 400 ? { detail: JSON.stringify(json).slice(0, 200) } : {}) };
    } catch (err) {
      return { ok: false, status: 0, detail: (err as Error).message };
    }
  }

  async stopPriceTracking(canonicalProductId: string): Promise<{ ok: boolean; status: number; detail?: string }> {
    if (!this.enabled) return { ok: false, status: 0, detail: "channel3 disabled (no api key)" };
    try {
      const { status } = await this.transport.post(
        `${this.baseUrl}/v0/price-tracking/stop`,
        { canonical_product_id: canonicalProductId },
        this.apiKey as string,
        this.timeoutMs,
      );
      return { ok: status === 200 || status === 201, status };
    } catch (err) {
      return { ok: false, status: 0, detail: (err as Error).message };
    }
  }

  async priceHistory(canonicalProductId: string): Promise<Array<{ timestamp: string; price: number; currency: string }> | undefined> {
    if (!this.enabled || !this.transport.get) return undefined;
    try {
      const { status, json } = await this.transport.get(
        `${this.baseUrl}/v0/price-tracking/history/${encodeURIComponent(canonicalProductId)}`,
        this.apiKey as string,
        this.timeoutMs,
      );
      if (status !== 200) return undefined;
      return (json as { price_history?: Array<{ timestamp: string; price: number; currency: string }> }).price_history;
    } catch {
      return undefined;
    }
  }

  async listPriceSubscriptions(): Promise<Array<{ canonical_product_id: string }> | undefined> {
    if (!this.enabled || !this.transport.get) return undefined;
    try {
      const { status, json } = await this.transport.get(
        `${this.baseUrl}/v0/price-tracking/subscriptions`,
        this.apiKey as string,
        this.timeoutMs,
      );
      if (status !== 200) return undefined;
      return (json as { subscriptions?: Array<{ canonical_product_id: string }> }).subscriptions;
    } catch {
      return undefined;
    }
  }
}

/** The price-drop webhook they fire (documented shape, no signature scheme). */
export interface PriceWebhookEvent {
  type: string;
  data?: { canonical_product_id?: string; new_price?: number | string; currency?: string; old_price?: number | string };
}

export function parsePriceWebhook(payload: unknown):
  | { kind: "price.changed"; productId: string; newPrice: string; currency: string; oldPrice?: string }
  | { kind: "ignored"; detail: string } {
  const e = payload as PriceWebhookEvent;
  if (!e || e.type !== "price.changed" || !e.data?.canonical_product_id) {
    return { kind: "ignored", detail: "not a price.changed event (or missing canonical_product_id)" };
  }
  const price = typeof e.data.new_price === "number" ? e.data.new_price.toFixed(2) : e.data.new_price;
  if (!price) return { kind: "ignored", detail: "missing new_price" };
  const old = typeof e.data.old_price === "number" ? e.data.old_price.toFixed(2) : e.data.old_price;
  return {
    kind: "price.changed",
    productId: e.data.canonical_product_id,
    newPrice: price,
    currency: e.data.currency ?? "USD",
    ...(old ? { oldPrice: old } : {}),
  };
}

/** Deterministic offline products, visibly labeled "sample" in the console.
 *  Samples carry multiple merchant offers so the price-comparison (and the
 *  cheaper-but-unauthorized drift story) demos without an API key. */
export function sampleProducts(query: string, _pageToken?: string): CatalogProduct[] {
  const q = query.trim().toLowerCase();
  const all: CatalogProduct[] = [
    { id: "sample-coffee-1", title: "Sample: single-origin coffee beans 1kg", price: "24.00", currency: "USD", description: "offline sample product", offers: [
      { price: "24.00", currency: "USD", merchant: "BeanBay" },
      { price: "21.50", currency: "USD", merchant: "off-grid-roasters" },
    ] },
    { id: "sample-keyboard-1", title: "Sample: mechanical keyboard, brown switches", price: "74.50", currency: "USD", description: "offline sample product", offers: [
      { price: "74.50", currency: "USD", merchant: "SampleMarket" },
      { price: "89.00", currency: "USD", merchant: "merch@keymagic.example" },
      { price: "96.00", currency: "USD", merchant: "BulkKeys" },
    ] },
    { id: "sample-merino-1", title: "Sample: merino wool crew sweater", price: "79.00", currency: "USD", description: "offline sample product", offers: [
      { price: "79.00", currency: "USD", merchant: "WoolDirect" },
    ] },
    { id: "sample-lamp-1", title: "Sample: LED desk lamp, dimmable", price: "39.00", currency: "USD", description: "offline sample product", offers: [
      { price: "39.00", currency: "USD", merchant: "LumenOne" },
      { price: "34.25", currency: "USD", merchant: "bargain-lights" },
    ] },
    { id: "sample-headphones-1", title: "Sample: wireless over-ear headphones", price: "129.00", currency: "USD", description: "offline sample product", offers: [
      { price: "129.00", currency: "USD", merchant: "AudioHaus" },
    ] },
    { id: "sample-bottle-1", title: "Sample: insulated steel water bottle 750ml", price: "29.00", currency: "USD", description: "offline sample product", offers: [
      { price: "29.00", currency: "USD", merchant: "HydroCore" },
    ] },
  ];
  if (!q) return all;
  const words = q.split(/\s+/);
  const scored = all
    .map((p) => ({ p, score: words.filter((w) => p.title.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).map((s) => s.p).slice(0, 6);
}
