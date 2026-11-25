import { describe, expect, it } from "vitest";
import { briefLabel, briefQuery, briefRank, fitBrief, matchBrief, oneToBuy, parseBrief, type Brief } from "../src/brief.ts";
import { classifyProduct } from "../src/classify.ts";
import type { DetectedProduct } from "../src/types.ts";

const prod = (name: string, price?: number, extra: Partial<DetectedProduct> = {}) =>
  classifyProduct({ name, price, url: `https://shop.test/p/${name.replace(/\s+/g, "-")}`, images: ["x.jpg"], via: "json-ld", ...extra });

describe("reading what you typed", () => {
  it("pulls out the piece, the colour, the price and the words that matter", () => {
    expect(parseBrief("black oversized tee under 800")).toEqual({ kind: "t-shirt", colors: ["black"], max: 800, words: ["oversized"] });
    expect(parseBrief("I want an olive linen shirt for a wedding below ₹1,500")).toEqual({ kind: "shirt", colors: ["olive"], max: 1500, words: ["linen", "wedding"] });
    expect(parseBrief("navy blue jeans")).toEqual({ kind: "jeans", colors: ["navy"], max: undefined, words: [] });
  });

  it("understands the ways people write a budget", () => {
    expect(parseBrief("sneakers 2k").max).toBe(2000);
    expect(parseBrief("kurta 1000 to 2,000").max).toBe(2000);
    expect(parseBrief("hoodie upto rs 1200").max).toBe(1200);
    expect(parseBrief("dress max 3k").max).toBe(3000);
    expect(parseBrief("white shirt ₹999").max).toBe(999);
    expect(parseBrief("shirt 1500 rupees").max).toBe(1500);
  });

  it("does not mistake a size for a price, and leaves colour words out of the extras", () => {
    const b = parseBrief("light blue shirt size 40");
    expect(b.max).toBeUndefined();
    expect(b.colors).toEqual(["blue"]);
    expect(b.words).toEqual(["size"]);
  });

  it("is fine with nothing useful", () => {
    expect(parseBrief("")).toEqual({ kind: undefined, colors: [], max: undefined, words: [] });
    expect(parseBrief("something nice for me")).toEqual({ kind: undefined, colors: [], max: undefined, words: [] });
  });

  it("says the brief back in a few words", () => {
    expect(briefLabel({ kind: "shirt", colors: ["olive", "navy"], max: 1500, words: [] })).toBe("Olive or navy shirts under ₹1,500");
    expect(briefLabel({ kind: "jeans", colors: [], words: ["baggy"] })).toBe("Baggy jeans");
    expect(briefLabel({ colors: ["black"], words: [] })).toBe("Black pieces");
    expect(briefLabel({ kind: "dress", colors: [], words: [], max: 2000 })).toBe("Dresses under ₹2,000");
    expect(briefQuery({ kind: "shirt", colors: ["olive", "navy"], max: 1500, words: ["linen"] })).toBe("olive linen shirt");
  });
});

describe("checking products against the brief", () => {
  const b: Brief = { kind: "shirt", colors: ["olive"], max: 1500, words: ["linen"] };
  const shelf = [
    prod("Olive linen shirt", 1299),
    prod("Green cotton shirt", 999),
    prod("Olive linen shirt, premium", 1700),
    prod("Maroon shirt", 899),
    prod("Olive t-shirt", 499),
    prod("Relaxed shirt", 1100),
    prod("Olive shirt, price on request"),
  ];

  it("matches kind, colour, price and extra words", () => {
    expect(matchBrief(shelf[0], b)).toEqual({ kind: true, colour: "exact", price: true, words: 1 });
    expect(matchBrief(shelf[1], b)).toMatchObject({ kind: true, colour: "near", price: true, words: 0 });
    expect(matchBrief(shelf[2], b)).toMatchObject({ colour: "exact", price: false });
    expect(matchBrief(shelf[3], b)).toMatchObject({ colour: "no" });
    expect(matchBrief(shelf[4], b)).toMatchObject({ kind: false });
    expect(matchBrief(shelf[5], b)).toMatchObject({ colour: "unknown" });
    expect(matchBrief(shelf[6], b)).toMatchObject({ colour: "exact", price: null });
  });

  it("puts exact fits first and fills a thin choice with close colours", () => {
    const r = fitBrief(shelf, b);
    expect(r.loosened).toBeNull();
    expect(r.fits.map((f) => f.product.name)).toEqual(["Olive linen shirt", "Olive shirt, price on request", "Green cotton shirt", "Relaxed shirt"]);
    const many = fitBrief([prod("Olive shirt one", 900), prod("Olive shirt two", 950), prod("Olive shirt three", 990), prod("Green shirt", 800)], b);
    expect(many.fits).toHaveLength(3);
    expect(many.fits.every((f) => f.match.colour === "exact")).toBe(true);
  });

  it("allows a close colour before it allows a higher price", () => {
    const r = fitBrief([shelf[1], shelf[2], shelf[3]], b);
    expect(r.loosened).toBe("colour");
    expect(r.fits.map((f) => f.product.name)).toEqual(["Green cotton shirt"]);
  });

  it("then stretches the price by up to a fifth, and no further", () => {
    expect(fitBrief([shelf[2], shelf[3]], b)).toMatchObject({ loosened: "price", fits: [{ product: { name: "Olive linen shirt, premium" } }] });
    expect(fitBrief([prod("Olive shirt deluxe", 2400), shelf[3]], b).fits).toEqual([]);
  });

  it("never offers the wrong kind of piece", () => {
    expect(fitBrief([shelf[4]], b).fits).toEqual([]);
  });

  it("with no colour or price asked, everything of that kind fits", () => {
    expect(fitBrief(shelf, { kind: "shirt", colors: [], words: [] }).fits).toHaveLength(6);
  });

  it("ranks a closer fit to the brief above an equal piece", () => {
    const exact = matchBrief(shelf[0], b), near = matchBrief(shelf[1], b);
    expect(briefRank(exact, 70, 1)).toBeGreaterThan(briefRank(near, 70, 1));
    expect(briefRank(near, 70, 3)).toBeGreaterThan(briefRank(near, 70, 0));
  });
});

describe("the one to buy", () => {
  const now = Date.parse("2026-11-25T10:00:00Z");
  const c = (id: string, score: number, price: number, pairs = 0, daysAgo = 1) => ({ id, score, price, pairs, ts: new Date(now - daysAgo * 864e5).toISOString() });

  it("picks the best piece and says why", () => {
    const r = oneToBuy([c("a", 82, 1299, 2), c("b", 78, 999, 1), c("c", 60, 499, 3)], { budget: 1500, now })!;
    expect(r.pick.id).toBe("a");
    expect(r.outOf).toBe(2);
    expect(r.why).toEqual(["Highest score of the 2", "₹201 under your budget", "Goes with 2 of yours"]);
  });

  it("lets budget and outfits break a near tie", () => {
    const r = oneToBuy([c("dear", 84, 2600, 0), c("fair", 82, 1400, 3)], { budget: 1500, now })!;
    expect(r.pick.id).toBe("fair");
    expect(r.why).toContain("₹100 under your budget");
  });

  it("does not let a small saving beat a clearly better piece", () => {
    expect(oneToBuy([c("great", 92, 1500), c("ok", 76, 700)], { budget: 1500, now })!.pick.id).toBe("great");
  });

  it("says nothing when nothing is worth buying", () => {
    expect(oneToBuy([c("a", 70, 900), c("b", 40, 500)], { now })).toBeNull();
    expect(oneToBuy([], { now })).toBeNull();
  });

  it("leaves out old looks and pieces you waved away", () => {
    expect(oneToBuy([c("old", 95, 900, 0, 40), c("new", 80, 900)], { withinDays: 21, now })!.pick.id).toBe("new");
    expect(oneToBuy([c("a", 90, 900), c("b", 80, 900)], { skip: ["a"], now })!.pick.id).toBe("b");
  });

  it("notes when the pick is also the cheaper of the top two", () => {
    const r = oneToBuy([c("a", 85, 900, 1), c("b", 84, 1300, 1)], { now })!;
    expect(r.pick.id).toBe("a");
    expect(r.why).toContain("₹400 less than the next best");
  });
});
