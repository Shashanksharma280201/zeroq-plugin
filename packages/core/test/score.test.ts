// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  budgetMax, classifyProduct, colourPart, isProductUrl, parseShopifyProducts, parseSitemap, productLinks, rankSitemaps,
  scoreItem, sitemapsFromRobots, textFacts, WEIGHTS, type ItemFacts, type ScoreProfile,
} from "../src/index.ts";

const profile: ScoreProfile = {
  best: [{ name: "Navy", hex: "#1f2a52" }, { name: "Olive", hex: "#66703e" }, { name: "Rust", hex: "#9a4f2c" }, { name: "Off white", hex: "#efeadf" }],
  avoid: [{ name: "Neon orange", hex: "#ff7a1e" }],
  likes: ["Straight, relaxed trousers", "Plain tops with no logos", "Earth tones"],
  dislikes: ["Loud prints", "Skinny fits"],
  never: "neon, skinny jeans",
  formality: { usual: 3, range: [2, 4] },
  useFrame: true,
  budget: "₹1,500 to 3,000",
};

const facts = (o: Partial<ItemFacts>): ItemFacts => ({
  category: "top", colors: [{ name: "Rust", hex: "#9a4f2c" }], formality: 3, styleFit: 4, shapeFit: 4,
  likesMatched: [], dislikesMatched: [], never: false, ...o,
});
const wardrobe = { size: 8, pairs: 3, twin: 0 };

describe("scoreItem", () => {
  it("is deterministic and explains every point", () => {
    const a = scoreItem(facts({}), profile, wardrobe);
    const b = scoreItem(facts({}), profile, wardrobe);
    expect(a).toEqual(b);
    const sum = a.parts.reduce((s, p) => s + p.points, 0);
    expect(Math.round(sum)).toBe(a.raw);
    expect(a.parts.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
  });

  it("weights sum to one", () => {
    expect(Object.values(WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 6);
  });

  it("rewards an item in your palette and taste", () => {
    const r = scoreItem(facts({ styleFit: 5, shapeFit: 5, likesMatched: [2] }), profile, { size: 8, pairs: 4, twin: 0 });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.verdict).toBe("Made for you");
  });

  it("caps a go-easy colour at 45 even when everything else is perfect", () => {
    const r = scoreItem(facts({ colors: [{ name: "Neon orange", hex: "#ff7b20" }], styleFit: 5, shapeFit: 5 }), profile, { size: 8, pairs: 4, twin: 0 });
    expect(r.score).toBe(45);
    expect(r.caps[0].reason).toMatch(/go-easy neon orange/);
  });

  it("caps never-wear at 25 and picks the strictest cap", () => {
    const r = scoreItem(facts({ never: true, colors: [{ name: "Neon", hex: "#ff7b20" }] }), profile, { size: 8, pairs: 4, twin: 0.97, twinName: "Rust overshirt" });
    expect(r.score).toBe(25);
    expect(r.caps.map((c) => c.cap)).toEqual([25, 40, 45]);
  });

  it("caps a near twin at 40", () => {
    const r = scoreItem(facts({ styleFit: 5 }), profile, { size: 8, pairs: 4, twin: 0.97, twinName: "Rust overshirt" });
    expect(r.score).toBe(40);
  });

  it("takes 10 off when well over budget", () => {
    const base = scoreItem(facts({ price: 2500 }), profile, wardrobe).score;
    const over = scoreItem(facts({ price: 6000 }), profile, wardrobe).score;
    expect(base - over).toBe(10);
  });

  it("drops parts that do not apply and re-weights the rest", () => {
    const r = scoreItem(facts({ shapeFit: 4 }), { ...profile, useFrame: false }, { size: 0, pairs: 0, twin: 0 });
    expect(r.parts.map((p) => p.key)).toEqual(["colour", "style", "occasion"]);
    expect(r.parts.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 6);
  });
});

describe("colour", () => {
  it("lets neutrals through and measures distance otherwise", () => {
    expect(colourPart([{ name: "Black", hex: "#111111" }], profile.best, profile.avoid)!.value).toBeGreaterThanOrEqual(70);
    expect(colourPart([{ name: "Rust", hex: "#9b502d" }], profile.best, profile.avoid)!.value).toBe(100);
    expect(colourPart([{ name: "Lime", hex: "#a6e22e" }], profile.best, profile.avoid)!.value).toBeLessThan(50);
  });
});

describe("text prefilter", () => {
  it("finds likes, dislikes and never-wear in product text", () => {
    const p = classifyProduct({ name: "Men Skinny Fit Stretch Jeans", url: "u", images: [], via: "json-ld", description: "Loud prints all over" });
    const f = textFacts(p, profile);
    expect(f.never).toBe(true);
    expect(f.dislikesMatched).toEqual([0, 1]);
  });
  it("reads a budget", () => {
    expect(budgetMax("₹1,500 to 3,000")).toBe(3000);
    expect(budgetMax("Under ₹1,500")).toBe(1500);
    expect(budgetMax("₹6,000+")).toBeNull();
  });
});

describe("catalogue", () => {
  it("parses a Shopify feed and skips sold-out products", () => {
    const ps = parseShopifyProducts({
      products: [
        { title: "Rust Overshirt", handle: "rust-overshirt", vendor: "Snitch", product_type: "Shirts", tags: ["overshirt"], body_html: "<p>Heavy cotton</p>",
          options: [{ name: "Color", values: ["Rust"] }], images: [{ src: "https://cdn/x.jpg" }], variants: [{ price: "1899.00", available: true }, { price: "1799.00", available: false }] },
        { title: "Gone", handle: "gone", variants: [{ price: "10", available: false }] },
      ],
    }, "https://brand.in");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ url: "https://brand.in/products/rust-overshirt", price: 1899, color: "Rust", brand: "Snitch" });
  });

  it("parses sitemaps, robots and product URLs", () => {
    const idx = parseSitemap(`<?xml version="1.0"?><sitemapindex><sitemap><loc>https://b.in/sitemap_pages_1.xml</loc></sitemap><sitemap><loc>https://b.in/sitemap_products_1.xml</loc></sitemap></sitemapindex>`);
    expect(rankSitemaps(idx.sitemaps)[0]).toContain("products");
    const set = parseSitemap(`<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://b.in/products/navy-shirt</loc><image:image><image:loc>https://cdn/n.jpg</image:loc><image:title>Navy Shirt</image:title></image:image></url></urlset>`);
    expect(set.urls[0]).toEqual({ loc: "https://b.in/products/navy-shirt", image: "https://cdn/n.jpg", title: "Navy Shirt" });
    expect(sitemapsFromRobots("User-agent: *\nSitemap: https://b.in/sitemap.xml")).toEqual(["https://b.in/sitemap.xml"]);
    expect(isProductUrl("https://b.in/products/navy-shirt")).toBe(true);
    expect(isProductUrl("https://b.in/collections/shirts")).toBe(false);
    expect(isProductUrl("https://b.in/blogs/news/how-to")).toBe(false);
  });

  it("finds product links on a listing page", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<a href="/products/a"><img src="/a.jpg" alt="A shirt"></a><a href="/collections/all">All</a><a href="https://other.com/products/x">x</a>`;
    expect(productLinks(d, "https://b.in")).toEqual([{ loc: "https://b.in/products/a", image: "https://b.in/a.jpg", title: "A shirt" }]);
  });
});
