import { describe, expect, it } from "vitest";
import {
  buildMemory, describeEvent, isStretchPick, memoryBlock, retrieveEvents, scoreItem, stretchFor,
  type ItemFacts, type ScoreProfile, type ZQEvent,
} from "../src/index.ts";

let n = 0;
const ev = (type: ZQEvent["type"], payload: any, ts = `2026-10-${String(10 + (n % 18)).padStart(2, "0")}T10:00:00Z`): ZQEvent => ({
  id: String(++n).padStart(26, "0"), ts, type, payload, v: 1, device: "t",
});

const profile: ScoreProfile = {
  best: [{ name: "Navy", hex: "#1f2a44" }, { name: "Olive", hex: "#556b2f" }],
  avoid: [{ name: "Mustard", hex: "#d4a017" }],
  likes: ["relaxed fits"], dislikes: ["logos"], never: "crop tops",
  formality: { usual: 3, range: [2, 3] }, useFrame: false, budget: "₹1,500 to 3,000",
};
const facts = (o: Partial<ItemFacts> = {}): ItemFacts => ({
  category: "top", colors: [{ name: "Navy", hex: "#1f2a44" }], formality: 3, styleFit: 4, shapeFit: null,
  likesMatched: [], dislikesMatched: [], never: false, ...o,
});
const wf = { size: 10, pairs: 2, twin: 0 };

describe("buildMemory", () => {
  const events = [
    ev("bought", { itemKey: "a", name: "Mustard overshirt", category: "top", colors: [{ name: "Mustard", hex: "#d0a020" }], price: 4200, currency: "INR", brand: "Snitch", formality: 3 }),
    ev("bought", { itemKey: "a", name: "dup", price: 4200 }),
    ev("bought", { itemKey: "b", name: "Tan chinos", category: "bottom", colors: ["beige"], price: 2600, brand: "Snitch", formality: 4 }),
    ev("item_rated", { itemKey: "c", name: "Linen shirt", category: "top", score: 86, price: 3900, brand: "Zara" }),
    ev("item_rated", { itemKey: "a", name: "Mustard overshirt", category: "top", score: 44, price: 4200, brand: "Snitch" }),
    ev("rating_feedback", { itemKey: "a", score: 44, verdict: "low", reasons: ["colour"], colors: [{ name: "Mustard", hex: "#d4a017" }], price: 4200 }),
    ev("dismissed", { itemKey: "d", stretch: "budget", colors: [{ name: "Red", hex: "#c0392b" }] }),
    ev("outfit_worn", { occasion: "Office", formality: 4 }),
    ev("note_removed", { noteId: "n1" }),
  ];
  const m = buildMemory(events, { ...buildMemory([]), notes: [{ id: "n1", text: "x", evidence: [], at: "" }, { id: "n2", text: "keep", evidence: [], at: "" }] });

  it("counts purchases once per item and summarises spend", () => {
    expect(m.spend.bought).toBe(2);
    expect(m.spend.prices).toEqual([2600, 4200]);
    expect(m.spend.max).toBe(4200);
    expect(m.spend.currency).toBe("INR");
  });
  it("clusters colours and records what you chose and refused", () => {
    const mustard = m.colours.find((c) => c.name === "Mustard")!;
    expect(mustard.bought).toBe(1);
    expect(mustard.up).toBe(1);
    expect(m.colours.find((c) => c.name === "Red")!.dismissed).toBe(1);
    expect(m.colours.find((c) => c.name === "beige")?.bought).toBe(1);
  });
  it("tracks brands, formality, feedback, high-not-bought and removed notes", () => {
    expect(m.brands[0].brand).toBe("Snitch");
    expect(m.brands[0].bought).toBe(2);
    expect(m.formality.bought[4]).toBe(1);
    expect(m.formality.worn[4]).toBe(1);
    expect(m.feedback).toMatchObject({ total: 1, low: 1, byReason: { colour: 1 } });
    expect(m.highNotBought.map((h) => h.itemKey)).toEqual(["c"]);
    expect(m.stretch.dismissed.budget).toBe(1);
    expect(m.notes.map((x) => x.id)).toEqual(["n2"]);
  });
  it("writes a compact history block", () => {
    const b = memoryBlock(m, profile.budget);
    expect(b).toContain("Bought 2 pieces");
    expect(b).toContain("mustard");
    expect(b).toContain("too low 1");
    expect(b.length).toBeLessThan(4000);
    expect(memoryBlock(buildMemory([]))).toBe("");
  });
});

describe("notes", () => {
  it("come from the newest notes_written event, minus removed ones", () => {
    const m = buildMemory([
      ev("notes_written", { notes: [{ id: "a", text: "old", evidence: [], at: "" }] }),
      ev("notes_written", { notes: [{ id: "b", text: "new", evidence: [], at: "" }, { id: "c", text: "gone", evidence: [], at: "" }] }),
      ev("note_removed", { noteId: "c" }),
    ]);
    expect(m.notes.map((n) => n.text)).toEqual(["new"]);
  });
});

describe("stretchFor", () => {
  it("never scores a stretch above 95", () => {
    const m = buildMemory([1, 2, 3, 4].map((i) => ev("bought", { itemKey: `k${i}`, colors: [{ name: "Mustard", hex: "#d4a017" }] })));
    const s = stretchFor(facts({ colors: [{ name: "Mustard", hex: "#d4a017" }], styleFit: 5 }), profile, { size: 10, pairs: 4, twin: 0 }, m)!;
    expect(s.score).toBeLessThanOrEqual(95);
  });
  it("returns null when nothing is broken", () => {
    expect(stretchFor(facts({ price: 2000 }), profile, wf, buildMemory([]))).toBeNull();
  });
  it("never relaxes never-wear", () => {
    const m = buildMemory([ev("bought", { price: 9000 })]);
    expect(stretchFor(facts({ never: true, price: 9000 }), profile, wf, m)).toBeNull();
  });
  it("lets budget give way when you have bought near this price", () => {
    const item = facts({ price: 5000 });
    const none = stretchFor(item, profile, wf, buildMemory([]));
    expect(none).toBeNull();
    const m = buildMemory([ev("bought", { itemKey: "x", price: 4600 }), ev("bought", { itemKey: "y", price: 5200 })]);
    const s = stretchFor(item, profile, wf, m)!;
    expect(s.reasons[0].kind).toBe("budget");
    expect(s.reasons[0].label).toContain("2 pieces");
    expect(s.score).toBeGreaterThanOrEqual(scoreItem(item, profile, wf).score);
  });
  it("lifts the go-easy colour cap when history backs it", () => {
    const item = facts({ colors: [{ name: "Mustard", hex: "#d4a017" }], price: 2000 });
    const base = scoreItem(item, profile, wf);
    expect(base.score).toBeLessThanOrEqual(45);
    const m = buildMemory([
      ev("bought", { itemKey: "1", colors: [{ name: "Mustard", hex: "#d2a218" }] }),
      ev("tryon_run", { kept: true, colors: [{ name: "Mustard", hex: "#d4a017" }] }),
    ]);
    const s = stretchFor(item, profile, wf, m)!;
    expect(s.reasons[0].kind).toBe("colour");
    expect(s.score).toBeGreaterThan(base.score + 20);
    expect(isStretchPick(s)).toBe(s.score >= 75);
  });
  it("relaxes occasion from what you wore", () => {
    const item = facts({ formality: 5, price: 2000 });
    const m = buildMemory([ev("outfit_worn", { formality: 5 }), ev("outfit_worn", { formality: 5 })]);
    const s = stretchFor(item, profile, wf, m)!;
    expect(s.reasons.map((r) => r.kind)).toEqual(["occasion"]);
  });
  it("uses a wardrobe gap when nothing else supports a broken rule", () => {
    const s = stretchFor(facts({ price: 5000 }), profile, { size: 12, pairs: 4, twin: 0 }, buildMemory([]))!;
    expect(s.reasons[0].kind).toBe("gap");
    expect(s.reasons[0].label).toContain("4 things");
  });
  it("needs twice the proof for a kind you keep dismissing", () => {
    const base = [ev("bought", { itemKey: "x", price: 5000 })];
    const dis = [1, 2, 3].map(() => ev("dismissed", { stretch: "budget" }));
    const a = stretchFor(facts({ price: 5000 }), profile, wf, buildMemory(base))!;
    const b = stretchFor(facts({ price: 5000 }), profile, wf, buildMemory([...base, ...dis]))!;
    expect(b.evidence).toBeLessThan(a.evidence);
  });
});

describe("retrieveEvents", () => {
  const events = [
    ev("item_rated", { itemKey: "1", brand: "Zara", category: "top", score: 70 }),
    ev("bought", { itemKey: "2", brand: "Zara", category: "top", price: 3000 }),
    ev("product_viewed", { itemKey: "3", brand: "Zara" }),
    ev("rating_feedback", { itemKey: "9", verdict: "high", score: 80, category: "bottom" }),
  ];
  it("ranks by similarity times strength and skips weak types", () => {
    const r = retrieveEvents(events, { brand: "zara", category: "top", price: 2900 }, 8);
    expect(r.map((e) => e.payload.itemKey)).toEqual(["2", "1"]);
  });
  it("puts feedback on the same item first", () => {
    expect(retrieveEvents(events, { itemKey: "9", brand: "Zara" })[0].payload.itemKey).toBe("9");
  });
  it("describes events in plain words", () => {
    expect(describeEvent(events[1])).toMatch(/BOUGHT .* from Zara/);
    expect(describeEvent(events[3])).toContain("TOO HIGH");
  });
});
