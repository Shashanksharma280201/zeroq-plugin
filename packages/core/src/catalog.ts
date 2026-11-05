import type { DetectedProduct } from "./types.ts";

/**
 * Reading a brand's catalogue, in three ways, best first:
 *  1. Shopify's public product feed (/products.json): the whole catalogue as
 *     structured data in a few requests. Most Indian D2C brands run on Shopify.
 *  2. The sitemap (robots.txt, then /sitemap.xml): every product URL, often
 *     with its image and title.
 *  3. Product links on the page the person is looking at.
 * These functions only parse; fetching lives in the extension.
 */

// ---------- Shopify ----------

export function parseShopifyProducts(json: unknown, origin: string): DetectedProduct[] {
  const list = (json as any)?.products;
  if (!Array.isArray(list)) return [];
  const out: DetectedProduct[] = [];
  for (const p of list) {
    if (!p?.title || !p?.handle) continue;
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const available = variants.filter((v: any) => v.available !== false);
    if (variants.length && !available.length) continue; // sold out everywhere
    const prices = (available.length ? available : variants).map((v: any) => Number(v.price)).filter((n: number) => n > 0);
    const colourOption = (p.options ?? []).find((o: any) => /colou?r/i.test(o?.name ?? ""));
    out.push({
      name: String(p.title).trim(),
      url: `${origin}/products/${p.handle}`,
      images: (p.images ?? []).map((i: any) => i?.src).filter(Boolean).slice(0, 3),
      brand: p.vendor ? String(p.vendor) : undefined,
      price: prices.length ? Math.min(...prices) : undefined,
      description: stripHtml(`${p.product_type ?? ""}. ${(p.tags ?? []).join(", ")}. ${p.body_html ?? ""}`).slice(0, 400),
      color: colourOption?.values?.[0] ? String(colourOption.values[0]) : undefined,
      via: "json-ld",
    });
  }
  return out;
}

// ---------- sitemaps ----------

export interface SitemapEntry {
  loc: string;
  image?: string;
  title?: string;
}

export function parseSitemap(xml: string): { sitemaps: string[]; urls: SitemapEntry[] } {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const byTag = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagName(tag)).concat(Array.from(el.getElementsByTagName(`image:${tag}`)));
  const text = (el: Element | undefined) => el?.textContent?.trim() || undefined;
  const sitemaps = Array.from(doc.getElementsByTagName("sitemap")).map((s) => text(s.getElementsByTagName("loc")[0])).filter(Boolean) as string[];
  const urls: SitemapEntry[] = [];
  for (const u of Array.from(doc.getElementsByTagName("url"))) {
    const loc = text(u.getElementsByTagName("loc")[0]);
    if (!loc) continue;
    const img = u.getElementsByTagName("image:image")[0] ?? u.getElementsByTagName("image")[0];
    urls.push({
      loc,
      image: img ? text(byTag(img, "loc")[0]) : undefined,
      title: img ? text(byTag(img, "title")[0]) : undefined,
    });
  }
  return { sitemaps, urls };
}

export function sitemapsFromRobots(robots: string): string[] {
  return robots
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
    .filter(Boolean) as string[];
}

/** Product pages, not categories, blogs or policies. */
export function isProductUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (/\/(collections?|category|categories|blogs?|pages|policies|cart|account|search|journal|stores?)\/?$/.test(path)) return false;
  if (/\/(blogs?|pages|policies|account|cart)\//.test(path)) return false;
  return (
    /\/products?\/[^/]+/.test(path) ||
    /\/p\/[^/]+/.test(path) ||
    /\/buy(\/|$)/.test(path) ||
    /-p-\d+/.test(path) ||
    /\/\d{6,}(\/|$)/.test(path) ||
    /\.html?$/.test(path) && /\d{4,}/.test(path)
  );
}

/** Prefer the sitemaps that list products. */
export function rankSitemaps(urls: string[]): string[] {
  const score = (u: string) => (/product/i.test(u) ? 0 : /collection|categor|page|blog|post/i.test(u) ? 2 : 1);
  return [...urls].sort((a, b) => score(a) - score(b));
}

// ---------- the page itself ----------

/** Same-site product links on a listing page, with the picture next to each. */
export function productLinks(doc: Document, origin: string): SitemapEntry[] {
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    let href: string;
    try {
      href = new URL(a.getAttribute("href")!, origin).href.split("#")[0].split("?")[0];
    } catch {
      continue;
    }
    if (!href.startsWith(origin) || seen.has(href) || !isProductUrl(href)) continue;
    seen.add(href);
    const img = a.querySelector("img");
    out.push({ loc: href, image: img?.getAttribute("src") ? new URL(img.getAttribute("src")!, origin).href : undefined, title: (img?.getAttribute("alt") || a.textContent || "").trim().slice(0, 120) || undefined });
  }
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}
