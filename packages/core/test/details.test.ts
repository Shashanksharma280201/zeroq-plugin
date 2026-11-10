// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { decisionFor, detailsBlock, detectProduct, mySizeFor, pageFacts, quickFacts, scoreItem } from "../src/index.ts";

const page = (body: string, ld: object) => new DOMParser().parseFromString(`<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${body}</body></html>`, "text/html");

const LD = {
  "@type": "Product", name: "Rust cotton overshirt", brand: { name: "Snitch" }, image: "https://x.test/a.jpg",
  offers: { "@type": "Offer", price: "1499", priceCurrency: "INR", availability: "https://schema.org/InStock" },
  aggregateRating: { ratingValue: "4.3", reviewCount: "1204" },
  review: [{ reviewBody: "Runs a little small, size up." }, { reviewBody: "Lovely thick fabric." }],
};
const BODY = `<nav>Men Women Sale</nav><main><div class="pdp-info"><h1>Rust cotton overshirt</h1>
<span class="price">₹1,499</span> <del>₹2,499</del>
<div class="size-buttons"><button>S</button><button>M</button><button class="size-btn disabled">L</button><button disabled>XL</button></div>
<table><tr><th>Fabric</th><td>100% cotton twill</td></tr><tr><th>Fit</th><td>Relaxed</td></tr><tr><th>Wash care</th><td>Machine wash cold</td></tr></table>
<ul><li>Sleeve: Full sleeves</li><li>Free delivery over ₹999 with a long line of words that is not a spec at all really</li></ul>
<p>A heavyweight overshirt with two chest pockets, made to layer over a tee through the cooler months of the year.</p></div>
<div class="recommend-carousel"><h3>You may also like</h3><p>Blue denim jacket</p></div></main><footer>About us</footer>`;

describe("reading the whole product page", () => {
  const p = detectProduct(page(BODY, LD), "https://x.test/p/1")!;
  const d = p.details!;
  it("reads ratings and reviews from structured data", () => {
    expect(d.rating).toBe(4.3);
    expect(d.reviewCount).toBe(1204);
    expect(d.reviews).toHaveLength(2);
    expect(d.inStock).toBe(true);
  });
  it("reads the crossed-out price and works out the discount", () => {
    expect(d.mrp).toBe(2499);
    expect(d.discountPct).toBe(40);
  });
  it("reads size buttons and which are sold out", () => {
    expect(d.sizes).toEqual([{ label: "S", available: true }, { label: "M", available: true }, { label: "L", available: false }, { label: "XL", available: false }]);
  });
  it("reads fabric, fit and care from the spec rows", () => {
    expect(d.material).toBe("100% cotton twill");
    expect(d.fit).toBe("Relaxed");
    expect(d.care).toBe("Machine wash cold");
    expect(d.specs!.some(([k, v]) => k === "Sleeve" && v === "Full sleeves")).toBe(true);
  });
  it("keeps the product's own words and leaves out menus and other products", () => {
    expect(d.text).toContain("heavyweight overshirt");
    expect(d.text).not.toContain("denim jacket");
    expect(d.text).not.toContain("About us");
  });
  it("turns it into a block the AI can read", () => {
    const b = detailsBlock(p);
    expect(b).toContain("Price: INR 1499 (was 2499, 40% off)");
    expect(b).toContain("Sizes: S, M, L (sold out), XL (sold out)");
    expect(b).toContain("Buyer rating: 4.3 of 5 from 1204 ratings");
    expect(b).toContain("Runs a little small");
  });
  it("still works on a page with nothing extra", () => {
    const bare = detectProduct(page("<h1>Tee</h1>", { "@type": "Product", name: "Tee", image: "https://x.test/t.jpg" }), "https://x.test/t")!;
    expect(bare.name).toBe("Tee");
    expect(bare.details?.sizes).toBeUndefined();
  });
});

describe("the answer in pictures", () => {
  const profile = { best: [{ name: "Rust", hex: "#b9714c" }], avoid: [], likes: ["overshirts"], dislikes: [], formality: { usual: 3, range: [2, 4] as [number, number] }, useFrame: true, budget: "₹1,500 to 3,000" };
  const facts = { category: "outerwear", colors: [{ name: "Rust", hex: "#b9714c" }], formality: 3, styleFit: 5, shapeFit: 4, likesMatched: [0], dislikesMatched: [], never: false, price: 1499 };
  const wf = { size: 10, pairs: 6, twin: 0.2 };
  it("gives three decisions", () => {
    expect([91, 75, 74, 55, 54, 10].map(decisionFor)).toEqual(["buy", "buy", "wait", "wait", "skip", "skip"]);
  });
  it("makes up to four yes or no facts", () => {
    const f = quickFacts(scoreItem(facts, profile, wf), wf, 1499, profile.budget);
    expect(f.map((x) => [x.key, x.good, x.label])).toEqual([["style", true, "Your style"], ["colour", true, "Your colour"], ["budget", true, "₹1,501 under"], ["pairs", true, "Goes with 6"]]);
    const over = quickFacts(scoreItem({ ...facts, price: 4299 }, profile, wf), wf, 4299, profile.budget);
    expect(over.find((x) => x.key === "budget")).toEqual({ key: "budget", good: false, label: "₹1,299 over" });
  });
  it("lets buyers' ratings nudge the score, only with enough ratings", () => {
    const base = scoreItem(facts, profile, wf).score;
    expect(scoreItem({ ...facts, buyers: { rating: 3.1, count: 200 } }, profile, wf).score).toBeLessThan(base);
    expect(scoreItem({ ...facts, buyers: { rating: 3.1, count: 4 } }, profile, wf).score).toBe(base);
    expect(scoreItem({ ...facts, buyers: { rating: 3.1, count: 200 } }, profile, wf).adjustments[0].reason).toBe("Buyers rate it 3.1 of 5");
  });
  it("says whether your size is there", () => {
    const d = { sizes: [{ label: "S", available: true }, { label: "M", available: false }], rating: 4.3, reviewCount: 1204, mrp: 2499, discountPct: 40, material: "cotton twill" };
    const rows = pageFacts(d, { sizeAdvice: "Runs small, take one up.", season: "mild", reviewSummary: "Buyers like the fabric." }, { mySize: mySizeFor("outerwear", { top: "m" }), price: 1499 });
    expect(rows.map((r) => [r.key, r.tone, r.title])).toEqual([
      ["size", "warn", "Your M is sold out"], ["fabric", "plain", "Cotton twill"], ["reviews", "good", "4.3 out of 5 from 1,204 buyers"], ["price", "good", "40% off ₹2,499"],
    ]);
    // a store that sizes differently is listed plainly, never flagged
    expect(pageFacts(d, undefined, { mySize: "40" })[0]).toMatchObject({ tone: "plain", title: "In stock: S", text: "Sold out: M" });
    expect(pageFacts(undefined, undefined)).toEqual([]);
    expect(mySizeFor("bottom", { top: "M", bottom: "32" })).toBe("32");
  });
});
