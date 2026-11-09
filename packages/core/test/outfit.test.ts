import { describe, expect, it } from "vitest";
import { bestOutfit, colourNames, nameForHex, type WardrobeItem } from "../src/index.ts";

const w = (id: string, category: WardrobeItem["category"], colors: string[], formality = 3): WardrobeItem => ({ id, name: id, category, colors, formality, createdAt: "", wornCount: 0 } as WardrobeItem);
const wardrobe = [w("navy-chino", "bottom", ["navy"]), w("black-jean", "bottom", ["black"]), w("white-sneaker", "footwear", ["white"]), w("olive-jacket", "outerwear", ["olive"]), w("white-tee", "top", ["white"])];

describe("bestOutfit", () => {
  it("completes a top with a bottom and shoes", () => {
    const o = bestOutfit({ name: "Rust overshirt", category: "top", colors: ["orange"], formality: 3 }, wardrobe);
    expect(o.pieces[0].category).toBe("bottom");
    expect(o.pieces.map((p) => p.category)).toContain("footwear");
  });
  it("lets the AI's pick win its slot", () => {
    const o = bestOutfit({ name: "Rust overshirt", category: "top", colors: ["orange"], formality: 3 }, wardrobe, ["black-jean"]);
    expect(o.pieces[0].id).toBe("black-jean");
    expect(o.fromAI).toEqual(["black-jean"]);
  });
  it("never uses the piece itself", () => {
    const o = bestOutfit({ id: "white-tee", name: "White tee", category: "top", colors: ["white"], formality: 3 }, wardrobe);
    expect(o.pieces.find((p) => p.id === "white-tee")).toBeUndefined();
  });
  it("returns nothing when the wardrobe has nothing that fits", () => {
    expect(bestOutfit({ name: "Tee", category: "top", colors: ["white"], formality: 3 }, []).pieces).toEqual([]);
  });
});

describe("colour names", () => {
  it("names hex colours", () => {
    expect(nameForHex("#1f2a52")).toBe("navy");
    expect(nameForHex("#efeadf")).toMatch(/white|cream/);
  });
  it("maps swatches and plain names", () => {
    expect(colourNames([{ name: "Rust", hex: "#9a4f2c" }, "navy", { name: "Off white", hex: "#efeadf" }])).toContain("navy");
  });
});
