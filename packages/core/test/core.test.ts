// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildOutfits, checkProduct, classifyProduct, detectProduct, guessColors, guessKind, type WardrobeItem } from "../src/index.ts";

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.documentElement.innerHTML = html;
  return d;
}

let n = 0;
function item(p: Partial<WardrobeItem> & Pick<WardrobeItem, "name" | "category">): WardrobeItem {
  return { id: `i${++n}`, colors: [], formality: 3, source: "manual", createdAt: new Date().toISOString(), wornCount: 0, ...p };
}

describe("detectProduct", () => {
  it("reads JSON-LD inside @graph with offers array", () => {
    const d = doc(`<head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebPage" }, {
        "@type": ["Product"], name: "Men Navy Blue Slim Fit Oxford Shirt", brand: { "@type": "Brand", name: "Snitch" },
        image: ["/img/a.jpg", { url: "https://cdn.x/b.jpg" }],
        offers: [{ "@type": "Offer", price: "1,299.00", priceCurrency: "INR" }],
      }],
    })}</script></head>`);
    const p = detectProduct(d, "https://shop.example/p/1")!;
    expect(p.via).toBe("json-ld");
    expect(p.brand).toBe("Snitch");
    expect(p.price).toBe(1299);
    expect(p.images).toEqual(["https://shop.example/img/a.jpg", "https://cdn.x/b.jpg"]);
  });

  it("handles Shopify ProductGroup and skips broken JSON", () => {
    const d = doc(`<script type="application/ld+json">{oops</script>
      <script type="application/ld+json">${JSON.stringify({ "@type": "ProductGroup", name: "Olive Cargo", hasVariant: [{ "@type": "Product", offers: { price: 1999, priceCurrency: "INR" }, image: "https://c/x.jpg" }] })}</script>`);
    const p = detectProduct(d, "https://s/")!;
    expect(p.name).toBe("Olive Cargo");
    expect(p.price).toBe(1999);
    expect(p.images[0]).toBe("https://c/x.jpg");
  });

  it("falls back to Open Graph only for product pages", () => {
    const blog = doc(`<meta property="og:type" content="article"><meta property="og:title" content="10 ways to style">`);
    expect(detectProduct(blog, "https://b/")).toBeNull();
    const og = doc(`<meta property="og:type" content="product"><meta property="og:title" content="White Sneakers"><meta property="og:image" content="https://i/s.jpg"><meta property="product:price:amount" content="2499">`);
    expect(detectProduct(og, "https://s/")?.price).toBe(2499);
  });
});

describe("classify", () => {
  it("prefers specific kinds", () => {
    expect(guessKind("Graphic Oversized T-Shirt").kind).toBe("t-shirt");
    expect(guessKind("Linen Shirt Dress").category).toBe("one-piece");
    expect(guessKind("Formal Trousers").formality).toBe(4);
  });
  it("does not double count navy blue", () => {
    expect(guessColors("Navy Blue Chinos")).toEqual(["navy"]);
    expect(guessColors("Off-White and Black Sneakers")).toEqual(["cream", "black"]);
  });
});

describe("matching", () => {
  const wardrobe = [
    item({ name: "Navy oxford shirt", category: "top", kind: "shirt", colors: ["navy"] }),
    item({ name: "Beige chinos", category: "bottom", kind: "chinos", colors: ["beige"] }),
    item({ name: "Grey trousers", category: "bottom", kind: "trousers", colors: ["grey"], formality: 4 }),
    item({ name: "White sneakers", category: "footwear", kind: "sneakers", colors: ["white"], formality: 2 }),
    item({ name: "Red tee", category: "top", kind: "t-shirt", colors: ["red"], formality: 2 }),
  ];

  it("warns about a near duplicate", () => {
    const p = classifyProduct({ name: "Navy Blue Slim Oxford Shirt", url: "u", images: [], via: "json-ld" });
    const r = checkProduct(p, wardrobe);
    expect(r.duplicates[0]?.item.name).toBe("Navy oxford shirt");
    expect(r.verdict).toBe("skip");
  });

  it("finds pairs for something new", () => {
    const p = classifyProduct({ name: "White Linen Shirt", url: "u", images: [], via: "json-ld" });
    const r = checkProduct(p, wardrobe);
    expect(r.duplicates).toHaveLength(0);
    expect(r.pairs.map((x) => x.item.name)).toContain("Beige chinos");
    expect(r.verdict).toBe("buy");
  });

  it("builds outfits without reusing the same top", () => {
    const o = buildOutfits(wardrobe, { count: 2 });
    expect(o).toHaveLength(2);
    expect(new Set(o.map((x) => x.itemIds[0])).size).toBe(2);
  });
});
