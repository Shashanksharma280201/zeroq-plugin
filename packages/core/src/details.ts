import type { ProductDetails } from "./types.ts";
import { ldBlocks } from "./detect.ts";

/**
 * Everything a product page says beyond name, price and photo.
 *
 * Structured data first (ratings, reviews, variants, material), then the page
 * itself: size buttons, the crossed-out price, "Fabric: Cotton" rows, and the
 * product section's own words for the AI to read. No per-site code: every
 * reader looks for the patterns stores share.
 */
export function readDetails(doc: Document, ld: any | null, price?: number): ProductDetails {
  const d: ProductDetails = {};
  const str = (v: any): string | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) return str(v[0]);
    if (typeof v === "object") return str(v.name ?? v["@value"]);
    const s = String(v).replace(/\s+/g, " ").trim();
    return s || undefined;
  };
  const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const arr = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

  // ---------- structured data ----------
  if (ld) {
    const ar = ld.aggregateRating;
    if (ar) {
      const r = num(ar.ratingValue), best = num(ar.bestRating) ?? 5;
      if (r) d.rating = Math.round((r / best) * 50) / 10;
      d.reviewCount = num(ar.reviewCount ?? ar.ratingCount);
    }
    const reviews = arr(ld.review).map((r) => str(r?.reviewBody ?? r?.description)).filter(Boolean).slice(0, 5).map((r) => r!.slice(0, 220));
    if (reviews.length) d.reviews = reviews;
    d.material = str(ld.material);
    d.pattern = str(ld.pattern);
    d.category = str(ld.category);
    const variants = arr(ld.hasVariant);
    const offers = arr(ld.offers?.offers ?? ld.offers);
    const stock = (o: any) => { const a = str(o?.availability) ?? ""; return a ? !/OutOfStock|SoldOut|Discontinued/i.test(a) : undefined; };
    const sizes = new Map<string, boolean>();
    const colours = new Set<string>();
    for (const v of variants) {
      const size = str(v?.size), colour = str(v?.color);
      if (size) sizes.set(size, sizes.get(size) || stock(arr(v.offers)[0]) !== false);
      if (colour) colours.add(colour);
    }
    if (!sizes.size) for (const s of arr(ld.size)) { const l = str(s); if (l) sizes.set(l, true); }
    if (sizes.size) d.sizes = [...sizes].map(([label, available]) => ({ label, available }));
    if (colours.size) d.colours = [...colours].slice(0, 12);
    const any = offers.map(stock).filter((x) => x !== undefined);
    if (any.length) d.inStock = any.some(Boolean);
    const high = num(ld.offers?.highPrice);
    if (high && price && high > price * 1.05) d.mrp = high;
    const props = arr(ld.additionalProperty).map((p) => [str(p?.name), str(p?.value)] as const).filter((p): p is readonly [string, string] => !!p[0] && !!p[1]);
    if (props.length) d.specs = props.slice(0, 16).map(([k, v]) => [k, v]);
  }
  // the store's own category path
  if (!d.category) {
    for (const b of ldBlocks(doc)) {
      const crumbs = findType(b, "BreadcrumbList");
      const names = arr(crumbs?.itemListElement).map((e) => str(e?.name ?? e?.item?.name)).filter(Boolean);
      if (names.length > 1) { d.category = names.slice(-4).join(" > "); break; }
    }
  }

  // ---------- the page itself ----------
  const area = productArea(doc);
  if (area) {
    // the crossed-out price
    if (!d.mrp && price) {
      for (const el of Array.from(area.querySelectorAll('del, s, strike, [class*="mrp" i], [class*="strike" i], [class*="compare" i], [class*="original" i], [class*="was-price" i], [class*="old-price" i]')).slice(0, 12)) {
        const n = num(el.textContent);
        if (n && n > price * 1.05 && n < price * 10) { d.mrp = n; break; }
      }
    }
    // size buttons
    if (!d.sizes) {
      const SIZE = /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl|free size|one size|onesize|os|\d{1,2}(\.5)?|uk ?\d{1,2}(\.5)?|eu ?\d{2}|us ?\d{1,2}(\.5)?|\d{2}[a-f]{1,2}|\d{2}\/\d{2})$/i;
      for (const box of Array.from(area.querySelectorAll('[class*="size" i], [id*="size" i], [data-option-name*="size" i], fieldset')).slice(0, 20)) {
        const opts = Array.from(box.querySelectorAll('button, label, li, option, a, [role="radio"], input[type="radio"]'));
        const found = new Map<string, boolean>();
        for (const o of opts) {
          const label = (o.getAttribute("value") && o.tagName === "INPUT" ? o.getAttribute("value")! : o.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!SIZE.test(label)) continue;
          const cls = `${o.getAttribute("class") ?? ""} ${o.parentElement?.getAttribute("class") ?? ""}`;
          const off = o.hasAttribute("disabled") || o.getAttribute("aria-disabled") === "true" || /disabled|sold|unavailable|out-of|outofstock|strike|crossed/i.test(cls);
          found.set(label.toUpperCase(), !off || found.get(label.toUpperCase()) === true);
        }
        if (found.size >= 2) { d.sizes = [...found].slice(0, 16).map(([label, available]) => ({ label, available })); break; }
      }
    }
    // "Fabric: Cotton" rows: tables, definition lists and labelled lines
    const specs = new Map<string, string>((d.specs ?? []).map(([k, v]) => [k.toLowerCase(), v]));
    const put = (k?: string | null, v?: string | null) => {
      k = k?.replace(/\s+/g, " ").replace(/[:\-–]\s*$/, "").trim(); v = v?.replace(/\s+/g, " ").trim();
      if (k && v && k.length < 32 && v.length < 140 && !specs.has(k.toLowerCase()) && specs.size < 20) specs.set(k.toLowerCase(), v);
    };
    for (const tr of Array.from(area.querySelectorAll("tr")).slice(0, 40)) { const c = tr.querySelectorAll("th, td"); if (c.length === 2) put(c[0].textContent, c[1].textContent); }
    for (const dt of Array.from(area.querySelectorAll("dt")).slice(0, 40)) put(dt.textContent, dt.nextElementSibling?.tagName === "DD" ? dt.nextElementSibling.textContent : null);
    for (const li of Array.from(area.querySelectorAll("li, p")).slice(0, 200)) {
      const m = (li.textContent ?? "").replace(/\s+/g, " ").trim().match(/^([A-Za-z][A-Za-z &/]{2,28})\s*[:\-–]\s*(.{2,120})$/);
      if (m) put(m[1], m[2]);
    }
    if (specs.size) d.specs = [...specs].map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]);
    // what the page says about itself, for the AI
    const words = pageText(area);
    if (words.length > 80) d.text = words.slice(0, 2600);
  }
  const spec = (re: RegExp) => d.specs?.find(([k]) => re.test(k))?.[1];
  d.material ??= spec(/fabric|material|composition/i);
  d.fit ??= spec(/^fit|fit type|fit$/i);
  d.care ??= spec(/care|wash/i);
  d.pattern ??= spec(/pattern|print/i);
  if (d.mrp && price && d.mrp > price) d.discountPct = Math.round((100 * (d.mrp - price)) / d.mrp);
  for (const k of Object.keys(d) as Array<keyof ProductDetails>) if (d[k] == null) delete d[k];
  return d;
}

function findType(node: any, type: string, depth = 0): any | null {
  if (!node || typeof node !== "object" || depth > 5) return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findType(n, type, depth + 1); if (f) return f; } return null; }
  const t = node["@type"];
  if ((Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && x.endsWith(type))) return node;
  return node["@graph"] ? findType(node["@graph"], type, depth + 1) : null;
}

/** The part of the page that is about this product: around its heading, not the header, footer or carousels of other products. */
function productArea(doc: Document): Element | null {
  const marked = doc.querySelector('[itemtype*="schema.org/Product"], [class*="pdp" i], [class*="product-detail" i], [class*="product-info" i], [class*="product-single" i], [id*="product-detail" i], main [class*="product" i]');
  const h1 = doc.querySelector("h1");
  let el: Element | null = h1;
  // climb from the heading until the block is big enough to hold the details
  for (let i = 0; el && i < 6; i++) {
    if ((el.textContent ?? "").length > 900 && el !== doc.body) break;
    if (!el.parentElement || el.parentElement === doc.body) break;
    el = el.parentElement;
  }
  const byHeading = el && el !== h1 ? el : null;
  if (marked && byHeading) return marked.contains(byHeading) || (marked.textContent ?? "").length > (byHeading.textContent ?? "").length ? marked : byHeading;
  return marked ?? byHeading ?? doc.querySelector("main") ?? doc.body;
}

function pageText(area: Element): string {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "NAV", "FOOTER", "HEADER", "FORM", "SELECT", "IFRAME", "TEMPLATE"]);
  const out: string[] = [];
  let size = 0;
  const walk = (n: Node) => {
    if (size > 3200) return;
    if (n.nodeType === 3) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 1) { out.push(t); size += t.length + 1; }
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (skip.has(e.tagName.toUpperCase()) || /recommend|similar|also-like|related|carousel|footer|breadcrumb|cookie|newsletter/i.test(e.getAttribute("class") ?? "")) return;
    for (const c of Array.from(e.childNodes)) walk(c);
  };
  walk(area);
  // drop the lines that repeat (menus rendered twice, size lists)
  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(" | ");
}
