import {
  detectProduct, isProductUrl, parseShopifyProducts, parseSitemap, rankSitemaps, sitemapsFromRobots,
  type DetectedProduct, type SitemapEntry,
} from "@zq/core";
import { getBlob, putBlob } from "./db.ts";

/**
 * Reads a brand's catalogue from its own site. Runs in the side panel (it
 * needs DOMParser). Polite by design: one site only, started by you, at most
 * four requests at a time with a pause between them, and a hard cap on pages.
 */

export interface Catalog {
  origin: string;
  brand: string;
  products: DetectedProduct[];
  source: "shopify" | "sitemap" | "page";
  readAt: number;
}

export interface Progress {
  stage: "feed" | "sitemap" | "links" | "pages" | "done";
  read: number;
  total: number;
}

const TTL = 12 * 60 * 60 * 1000;
const MAX_PAGES = 120;
const MAX_FEED_PAGES = 4;
const CONCURRENCY = 4;
const PAUSE_MS = 150;

const cacheKey = (origin: string) => `catalog:${origin}`;

export async function cachedCatalog(origin: string): Promise<Catalog | null> {
  const b = await getBlob(cacheKey(origin));
  if (!b) return null;
  try {
    const c = JSON.parse(await b.text()) as Catalog;
    return Date.now() - c.readAt < TTL ? c : null;
  } catch {
    return null;
  }
}

export async function readCatalog(origin: string, opts: { tabId?: number; signal?: AbortSignal; onProgress?: (p: Progress) => void; fresh?: boolean }): Promise<Catalog> {
  if (!opts.fresh) {
    const hit = await cachedCatalog(origin);
    if (hit) return hit;
  }
  const say = (p: Progress) => opts.onProgress?.(p);
  let products: DetectedProduct[] = [];
  let source: Catalog["source"] = "shopify";

  // 1. Shopify feed
  say({ stage: "feed", read: 0, total: 0 });
  for (let page = 1; page <= MAX_FEED_PAGES; page++) {
    const json = await getJson(`${origin}/products.json?limit=250&page=${page}`, opts.signal);
    const batch = json ? parseShopifyProducts(json, origin) : [];
    products.push(...batch);
    say({ stage: "feed", read: products.length, total: products.length });
    if (!json || ((json as any).products?.length ?? 0) < 250) break;
  }

  // 2. Sitemap, then 3. links on the page you are on
  if (!products.length) {
    source = "sitemap";
    say({ stage: "sitemap", read: 0, total: 0 });
    let entries = await sitemapEntries(origin, opts.signal);
    if (!entries.length && opts.tabId != null) {
      source = "page";
      say({ stage: "links", read: 0, total: 0 });
      entries = ((await chrome.tabs.sendMessage(opts.tabId, { type: "links" }).catch(() => [])) as SitemapEntry[]) ?? [];
    }
    products = await readPages(entries.slice(0, MAX_PAGES), opts.signal, (read, total) => say({ stage: "pages", read, total }));
  }

  const catalog: Catalog = { origin, brand: brandName(products, origin), products: dedupe(products), source, readAt: Date.now() };
  say({ stage: "done", read: catalog.products.length, total: catalog.products.length });
  await putBlob(cacheKey(origin), new Blob([JSON.stringify(catalog)], { type: "application/json" }));
  return catalog;
}

async function sitemapEntries(origin: string, signal?: AbortSignal): Promise<SitemapEntry[]> {
  const robots = await getText(`${origin}/robots.txt`, signal);
  const queue = rankSitemaps(robots ? sitemapsFromRobots(robots).filter((u) => u.startsWith(origin)) : []);
  if (!queue.length) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < 8 && out.length < 400) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const xml = await getText(url, signal);
    fetched++;
    if (!xml) continue;
    const { sitemaps, urls } = parseSitemap(xml);
    queue.unshift(...rankSitemaps(sitemaps.filter((s) => s.startsWith(origin))).slice(0, 4));
    for (const u of urls) if (u.loc.startsWith(origin) && isProductUrl(u.loc)) out.push(u);
  }
  return out;
}

async function readPages(entries: SitemapEntry[], signal: AbortSignal | undefined, tick: (read: number, total: number) => void): Promise<DetectedProduct[]> {
  const out: DetectedProduct[] = [];
  let next = 0;
  let read = 0;
  tick(0, entries.length);
  const worker = async () => {
    while (next < entries.length) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const e = entries[next++];
      const html = await getText(e.loc, signal);
      let p: DetectedProduct | null = null;
      if (html) p = detectProduct(new DOMParser().parseFromString(html, "text/html"), e.loc);
      // A product page with no structured data still has its sitemap title and picture.
      if (!p && e.title && e.image) p = { name: e.title, url: e.loc, images: [e.image], via: "open-graph" };
      if (p) out.push({ ...p, url: e.loc, images: p.images.length ? p.images : e.image ? [e.image] : [] });
      tick(++read, entries.length);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

async function getText(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "omit", signal: anySignal(signal, 12_000) });
    return res.ok ? await res.text() : null;
  } catch (e: any) {
    if (e?.name === "AbortError" && signal?.aborted) throw e;
    return null;
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const t = await getText(url, signal);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function anySignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

function dedupe(ps: DetectedProduct[]): DetectedProduct[] {
  const seen = new Set<string>();
  return ps.filter((p) => {
    const k = p.url.split("?")[0];
    if (seen.has(k) || !p.images.length) return false;
    seen.add(k);
    return true;
  });
}

function brandName(ps: DetectedProduct[], origin: string): string {
  const counts = new Map<string, number>();
  for (const p of ps) if (p.brand) counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= ps.length / 3) return top[0];
  const host = new URL(origin).hostname.replace(/^www\./, "").split(".")[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
}
