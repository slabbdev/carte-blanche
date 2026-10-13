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
  /** Merchant / retailer name when the API provides it. */
  merchant?: string;
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
  /** Every known merchant offer, cheapest first — the price-comparison lens (drift story fuel). */
  offers: CatalogOffer[];
}

export interface CatalogResult {
  source: "channel3" | "sample";
  products: CatalogProduct[];
  error?: string;
}

export interface CatalogTransport {
  post(url: string, body: unknown, apiKey: string, timeoutMs: number): Promise<{ status: number; json: unknown }>;
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
};

interface RawOffer {
  price?: number | string;
  currency?: string;
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
  images?: Array<{ url?: string; cleaned_url?: string | null; is_main_image?: boolean }> | null;
}

function formatPrice(raw: number | string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n.toFixed(2);
}

function mapProduct(raw: RawProduct): CatalogProduct | undefined {
  if (!raw?.id || !raw.title) return undefined;
  const offers: CatalogOffer[] = (raw.offers ?? [])
    .filter((o) => o?.price !== undefined && o?.price !== null)
    .map((o) => ({
      price: formatPrice(o.price) as string,
      currency: o.currency ?? raw.currency ?? "USD",
      ...(o.website?.name ? { merchant: o.website.name } : {}),
    }))
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
    offers,
  };
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

  async search(query: string, limit = 6): Promise<CatalogResult> {
    if (!this.enabled) return { source: "sample", products: sampleProducts(query) };
    try {
      const { status, json } = await this.transport.post(
        `${this.baseUrl}/v1/search`,
        { query, limit },
        this.apiKey as string,
        this.timeoutMs,
      );
      if (status !== 200) {
        return { source: "sample", products: sampleProducts(query), error: `channel3 http ${status}` };
      }
      const products = (Array.isArray((json as { products?: RawProduct[] }).products) ? (json as { products: RawProduct[] }).products : [])
        .map(mapProduct)
        .filter((p): p is CatalogProduct => Boolean(p));
      return { source: "channel3", products };
    } catch (err) {
      // The shopping scene must keep working offline — say what happened, fall back.
      return { source: "sample", products: sampleProducts(query), error: (err as Error).message };
    }
  }
}

/** Deterministic offline products, visibly labeled "sample" in the console.
 *  Samples carry multiple merchant offers so the price-comparison (and the
 *  cheaper-but-unauthorized drift story) demos without an API key. */
export function sampleProducts(query: string): CatalogProduct[] {
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
