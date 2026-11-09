import { describe, expect, it } from "vitest";
import { familiarFrom, noveltyOf } from "../src/index.ts";

const f = familiarFrom(
  [{ category: "top", colors: ["navy"] }, { category: "bottom", colors: ["beige"] }],
  [{ category: "top", colors: [{ name: "Black", hex: "#1d1d1f" }] }, { category: "top", colors: ["white"] }],
  3000,
);
describe("novelty", () => {
  it("knows what is familiar", () => {
    expect([...f.colours].sort()).toEqual(["beige", "black", "navy", "white"]);
    expect(f.categories.get("top")).toBe(3);
  });
  it("a familiar piece is not new", () => {
    expect(noveltyOf({ category: "top", colors: ["navy"], price: 1500 }, f).because).toEqual([]);
  });
  it("finds a new colour, a new kind and a stretch on price", () => {
    const n = noveltyOf({ category: "outerwear", colors: ["olive"], price: 4500 }, f);
    expect(n.because).toEqual(["colour", "category", "budget"]);
    expect(n.score).toBe(1);
  });
  it("a colour is only new if none of its colours are familiar", () => {
    expect(noveltyOf({ category: "top", colors: ["olive", "navy"] }, f).because).toEqual([]);
  });
});
