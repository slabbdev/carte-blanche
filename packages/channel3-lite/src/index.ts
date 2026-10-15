/**
 * channel3-lite — dependency-free client for the Channel3 shopping API.
 *
 * Extracted from the Carte Blanche hackathon project (PayPal AI Hackathon
 * 2026), where it feeds agents a real shopping scene. This package keeps the
 * part every Channel3 integrator needs and nothing else:
 *
 *   - the REAL response shape, mapped once (verified against
 *     api.trychannel3.com, 2026-10-14):
 *       * offer price is an OBJECT  { price, currency, compare_at_price }
 *         — sometimes a bare number/string, both handled;
 *       * the merchant is a bare DOMAIN ("keychron.com"), not an object;
 *       * every offer carries an affiliate `url` (buy.trychannel3.com) —
 *         that IS the monetization, together with max_commission_rate;
 *       * product ratings live in `ratings: {value, count}`;
 *       * images: prefer `cleaned_url` (grid-ready) over the hero shot;
 *       * pagination by opaque `next_page_token` (pass it back to search).
 *   - cheapest-offer-first sorting, so "buy the cheapest authorized offer"
 *     is a `[0]` instead of a client library;
 *   - injectable transport (tests, proxies, mocks) and no dependencies
 *     beyond fetch (Node >= 20).
 */

export interface CatalogOffer {
  /** Decimal string, e.g. "74.50". */
  price: string;
  currency: string;
  /** Merchant / retailer domain (e.g. "keychron.com") when the API provides it. */
  merchant?: string;
  /** Affiliate buy link for this offer (buy.trychannel3.com). */
  buyUrl?: string;
}

export interface CatalogProduct {
  id: string;
  title: string;
  description?: string;
  /** Decimal string of the CHEAPEST known offer — the price a mandate would pin. */
  price?: string;
  currency: string;
  image?: string;
  website?: string;
  rating?: number;
  ratingCount?: number;
  /** Every known merchant offer, cheapest first. */
  offers: CatalogOffer[];
}

export interface CatalogResult {
  products: CatalogProduct[];
  /** Channel3 pagination cursor — pass back to search() for the next page. */
  nextPageToken?: string;
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

/** A real search-response offer (verified against api.trychannel3.com, 2026-10-14). */
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

/** Raw API product -> clean product (cheapest offer first). Undefined when unusable. */
export function mapProduct(raw: RawProduct): CatalogProduct | undefined {
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

export class Channel3 {
  constructor(
    private readonly apiKey: string,
    private readonly options?: {
      transport?: CatalogTransport;
      baseUrl?: string; // default https://api.trychannel3.com
      timeoutMs?: number; // default 12000
    },
  ) {}

  get transport(): CatalogTransport {
    return this.options?.transport ?? catalogHttpTransport;
  }

  get baseUrl(): string {
    return this.options?.baseUrl ?? "https://api.trychannel3.com";
  }

  get timeoutMs(): number {
    return this.options?.timeoutMs ?? 12_000;
  }

  /** URL lookup: pass any retailer product URL, get the structured product back. */
  async lookupByUrl(url: string): Promise<CatalogProduct | undefined> {
    try {
      const { status, json } = await this.transport.post(
        `${this.baseUrl}/v1/lookup`,
        { url },
        this.apiKey,
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
    const { status, json } = await this.transport.post(
      `${this.baseUrl}/v1/search`,
      { query, limit, ...(pageToken ? { page_token: pageToken } : {}) },
      this.apiKey,
      this.timeoutMs,
    );
    if (status !== 200) throw new Error(`channel3 http ${status}`);
    const products = (Array.isArray((json as { products?: RawProduct[] }).products) ? (json as { products: RawProduct[] }).products : [])
      .map(mapProduct)
      .filter((p): p is CatalogProduct => Boolean(p));
    const next = (json as { next_page_token?: string }).next_page_token;
    return { products, ...(next ? { nextPageToken: next } : {}) };
  }
}
