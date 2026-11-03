import type { DetectedProduct } from "./types.ts";

/**
 * Find the product on a shopping page.
 *
 * Most fashion stores (Myntra, Ajio, H&M, Zara, every Shopify store) publish
 * schema.org Product data for Google Shopping, so one generic reader covers
 * almost every site without per-site code. Order of trust:
 *   1. JSON-LD  2. microdata  3. Open Graph product tags
 */
export function detectProduct(doc: Document, url = doc.location?.href ?? ""): DetectedProduct | null {
  return fromJsonLd(doc, url) ?? fromMicrodata(doc, url) ?? fromOpenGraph(doc, url);
}

// ---------- JSON-LD ----------

function fromJsonLd(doc: Document, url: string): DetectedProduct | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(s.textContent ?? "");
    } catch {
      continue;
    }
    const product = findProductNode(data);
    if (product) {
      const p = normaliseLd(product, url);
      if (p) return p;
    }
  }
  return null;
}

function isType(node: any, type: string): boolean {
  const t = node?.["@type"];
  if (!t) return false;
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && x.replace(/^.*[/#]/, "") === type);
}

function findProductNode(data: any, depth = 0): any | null {
  if (!data || typeof data !== "object" || depth > 6) return null;
  if (Array.isArray(data)) {
    for (const d of data) {
      const f = findProductNode(d, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (isType(data, "Product")) return data;
  // ProductGroup (variants) is used by Shopify and some big stores
  if (isType(data, "ProductGroup")) {
    const v = Array.isArray(data.hasVariant) ? data.hasVariant[0] : null;
    return { ...v, ...data, offers: data.offers ?? v?.offers, image: data.image ?? v?.image };
  }
  for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
    if (data[key]) {
      const f = findProductNode(data[key], depth + 1);
      if (f) return f;
    }
  }
  return null;
}

function normaliseLd(p: any, url: string): DetectedProduct | null {
  const name = text(p.name);
  if (!name) return null;
  const offer = firstOffer(p.offers);
  return {
    name,
    url: text(p.url) ? absolute(text(p.url)!, url) : url,
    images: images(p.image).map((i) => absolute(i, url)),
    brand: text(p.brand?.name ?? p.brand),
    price: num(offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price),
    currency: text(offer?.priceCurrency ?? offer?.priceSpecification?.priceCurrency),
    description: text(p.description)?.slice(0, 500),
    color: text(p.color),
    via: "json-ld",
  };
}

function firstOffer(offers: any): any {
  if (!offers) return undefined;
  if (Array.isArray(offers)) return offers[0];
  if (offers.offers) return firstOffer(offers.offers);
  return offers;
}

function images(img: any): string[] {
  if (!img) return [];
  if (typeof img === "string") return [img];
  if (Array.isArray(img)) return img.flatMap(images);
  if (typeof img === "object") return images(img.url ?? img.contentUrl);
  return [];
}

// ---------- microdata ----------

function fromMicrodata(doc: Document, url: string): DetectedProduct | null {
  const root = doc.querySelector('[itemtype*="schema.org/Product"]');
  if (!root) return null;
  const prop = (name: string) => {
    const el = root.querySelector(`[itemprop="${name}"]`);
    if (!el) return undefined;
    return (
      el.getAttribute("content") ??
      el.getAttribute("src") ??
      el.getAttribute("href") ??
      el.textContent?.trim() ??
      undefined
    );
  };
  const name = prop("name");
  if (!name) return null;
  const img = prop("image");
  return {
    name,
    url,
    images: img ? [absolute(img, url)] : [],
    brand: prop("brand"),
    price: num(prop("price")),
    currency: prop("priceCurrency"),
    description: prop("description")?.slice(0, 500),
    color: prop("color"),
    via: "microdata",
  };
}

// ---------- Open Graph ----------

function fromOpenGraph(doc: Document, url: string): DetectedProduct | null {
  const meta = (p: string) =>
    doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") ?? undefined;
  const type = meta("og:type")?.toLowerCase() ?? "";
  const price = meta("product:price:amount") ?? meta("og:price:amount");
  // Only trust OG when it clearly says this is a product, otherwise every
  // blog post with an og:image would look like a product.
  if (!type.includes("product") && !price) return null;
  const name = meta("og:title");
  if (!name) return null;
  const img = meta("og:image");
  return {
    name,
    url: meta("og:url") ?? url,
    images: img ? [absolute(img, url)] : [],
    brand: meta("product:brand") ?? meta("og:brand"),
    price: num(price),
    currency: meta("product:price:currency") ?? meta("og:price:currency"),
    description: meta("og:description")?.slice(0, 500),
    color: meta("product:color"),
    via: "open-graph",
  };
}

// ---------- helpers ----------

function text(v: any): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v.name ?? v["@value"]);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || undefined;
}

function num(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function absolute(u: string, base: string): string {
  try {
    return new URL(u, base || undefined).href;
  } catch {
    return u;
  }
}
