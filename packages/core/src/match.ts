import { NEUTRALS } from "./classify.ts";
import type { Category, ClassifiedProduct, DuplicateMatch, Outfit, PairMatch, ProductCheck, WardrobeItem } from "./types.ts";

type Itemish = Pick<WardrobeItem, "category" | "kind" | "colors" | "formality" | "name">;

/** Which categories go with which. */
export const PAIRS_WITH: Record<Category, Category[]> = {
  top: ["bottom", "outerwear", "footwear"],
  bottom: ["top", "outerwear", "footwear"],
  "one-piece": ["outerwear", "footwear", "accessory"],
  outerwear: ["top", "bottom", "one-piece"],
  footwear: ["bottom", "one-piece"],
  accessory: ["one-piece", "top"],
  other: [],
};

/** Colour pairs that read as clashing for everyday wear. */
const CLASHES = new Set(["red|pink", "red|orange", "pink|orange", "green|red", "purple|orange", "yellow|purple"]);
/** Colour pairs that are classics. */
const CLASSICS = new Set([
  "navy|white", "navy|beige", "navy|grey", "black|white", "grey|white", "beige|white",
  "denim|white", "denim|black", "olive|white", "olive|black", "olive|beige", "maroon|beige",
  "maroon|grey", "brown|cream", "brown|blue", "blue|beige", "blue|grey", "pink|navy",
  "pink|grey", "green|beige", "denim|navy", "cream|navy", "cream|olive", "black|beige",
]);

const key = (a: string, b: string) => [a, b].sort().join("|");

/** 0 to 1. How well two colour sets go together. */
export function colorHarmony(a: string[], b: string[]): { score: number; reason: string } {
  if (!a.length || !b.length) return { score: 0.5, reason: "colour unknown" };
  let best = { score: 0, reason: "" };
  for (const x of a) {
    for (const y of b) {
      let s: number;
      let r: string;
      const k = key(x, y);
      if (CLASSICS.has(k)) [s, r] = [1, `${x} and ${y} is a classic`];
      else if (CLASHES.has(k)) [s, r] = [0.1, `${x} and ${y} can clash`];
      else if (x === y && NEUTRALS.has(x)) [s, r] = [0.6, `tonal ${x}`];
      else if (x === y) [s, r] = [0.3, `both ${x}, a bit much`];
      else if (NEUTRALS.has(x) && NEUTRALS.has(y)) [s, r] = [0.8, `two neutrals, ${x} and ${y}`];
      else if (NEUTRALS.has(x) || NEUTRALS.has(y)) [s, r] = [0.85, `${NEUTRALS.has(x) ? x : y} grounds the ${NEUTRALS.has(x) ? y : x}`];
      else [s, r] = [0.4, `${x} with ${y} is bold`];
      if (s > best.score) best = { score: s, reason: r };
    }
  }
  return best;
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
const STOP = new Set(["men", "mens", "women", "womens", "the", "and", "with", "for", "fit", "regular", "slim", "pure", "cotton", "solid"]);

/** Items you already own that are basically the same thing. */
export function findDuplicates(p: Itemish, wardrobe: WardrobeItem[]): DuplicateMatch[] {
  const pt = tokens(p.name);
  const out: DuplicateMatch[] = [];
  for (const item of wardrobe) {
    if (item.category !== p.category || p.category === "other") continue;
    let score = 0.3;
    const reasons: string[] = [];
    if (p.kind && item.kind === p.kind) {
      score += 0.3;
      reasons.push(`another ${p.kind}`);
    }
    const sharedColors = p.colors.filter((c) => item.colors.includes(c));
    if (sharedColors.length) {
      score += 0.3;
      reasons.push(`same ${sharedColors[0]}`);
    } else if (p.colors.length && item.colors.length) {
      score -= 0.3;
    }
    const it = tokens(item.name);
    const overlap = [...pt].filter((w) => it.has(w)).length;
    if (overlap >= 2) score += 0.1;
    if (Math.abs(item.formality - p.formality) >= 2) score -= 0.2;
    if (score >= 0.85) {
      out.push({ item, score: Math.min(1, score), reason: `You own this: ${reasons.join(", ")}` });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Things you own that go with this product. */
export function findPairs(p: Itemish, wardrobe: WardrobeItem[], limit = 6): PairMatch[] {
  const wants = PAIRS_WITH[p.category] ?? [];
  const out: PairMatch[] = [];
  for (const item of wardrobe) {
    if (!wants.includes(item.category)) continue;
    const c = colorHarmony(p.colors, item.colors);
    const fGap = Math.abs(item.formality - p.formality);
    const f = fGap === 0 ? 1 : fGap === 1 ? 0.8 : fGap === 2 ? 0.4 : 0.1;
    // tops and bottoms matter most; shoes and layers are bonus
    const weight = (p.category === "top" && item.category === "bottom") || (p.category === "bottom" && item.category === "top") ? 1 : 0.85;
    const score = (c.score * 0.65 + f * 0.35) * weight;
    if (score >= 0.55) out.push({ item, score, reason: c.reason });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function checkProduct(product: ClassifiedProduct, wardrobe: WardrobeItem[]): ProductCheck {
  const duplicates = findDuplicates(product, wardrobe);
  const pairs = findPairs(product, wardrobe);
  let verdict: ProductCheck["verdict"] = "think";
  if (duplicates.length && duplicates[0].score >= 0.95) verdict = "skip";
  else if (!duplicates.length && pairs.length >= 2) verdict = "buy";
  return { product, duplicates, pairs, verdict };
}

/**
 * Offline outfit builder, used when no AI key is set and as the candidate
 * pool the AI picks from. Prefers things you have not worn lately.
 */
export function buildOutfits(wardrobe: WardrobeItem[], opts: { formality?: number; count?: number } = {}): Outfit[] {
  const target = opts.formality ?? 3;
  const tops = wardrobe.filter((i) => i.category === "top");
  const bottoms = wardrobe.filter((i) => i.category === "bottom");
  const shoes = wardrobe.filter((i) => i.category === "footwear");
  const layers = wardrobe.filter((i) => i.category === "outerwear");
  const freshness = (i: WardrobeItem) => {
    if (!i.lastWornAt) return 1;
    const days = (Date.now() - Date.parse(i.lastWornAt)) / 86_400_000;
    return Math.min(1, days / 7);
  };
  const fit = (i: WardrobeItem) => 1 - Math.min(1, Math.abs(i.formality - target) / 3);

  const combos: Array<{ score: number; items: WardrobeItem[]; why: string }> = [];
  for (const t of tops) {
    for (const b of bottoms) {
      const c = colorHarmony(t.colors, b.colors);
      const score = c.score * 0.5 + ((fit(t) + fit(b)) / 2) * 0.3 + ((freshness(t) + freshness(b)) / 2) * 0.2;
      const items = [t, b];
      const shoe = bestMatch(shoes, items, target);
      if (shoe) items.push(shoe);
      if (target >= 4) {
        const layer = bestMatch(layers, items, target);
        if (layer) items.push(layer);
      }
      combos.push({ score, items, why: c.reason });
    }
  }
  // one-pieces stand on their own
  for (const o of wardrobe.filter((i) => i.category === "one-piece")) {
    const items = [o];
    const shoe = bestMatch(shoes, items, target);
    if (shoe) items.push(shoe);
    combos.push({ score: fit(o) * 0.6 + freshness(o) * 0.3 + 0.1, items, why: "one piece, done" });
  }

  combos.sort((a, b) => b.score - a.score);
  // avoid three outfits all built on the same shirt
  const used = new Map<string, number>();
  const picked: Outfit[] = [];
  for (const c of combos) {
    if (picked.length >= (opts.count ?? 3)) break;
    if (c.items.some((i) => (used.get(i.id) ?? 0) >= 1 && i.category !== "footwear")) continue;
    c.items.forEach((i) => used.set(i.id, (used.get(i.id) ?? 0) + 1));
    picked.push({
      title: c.items.slice(0, 2).map((i) => i.name).join(" + "),
      itemIds: c.items.map((i) => i.id),
      why: capitalise(c.why),
    });
  }
  return picked;
}

function bestMatch(pool: WardrobeItem[], with_: WardrobeItem[], target: number): WardrobeItem | undefined {
  let best: { s: number; i?: WardrobeItem } = { s: 0.5 };
  for (const i of pool) {
    const c = Math.min(...with_.map((w) => colorHarmony(i.colors, w.colors).score));
    const s = c * 0.6 + (1 - Math.min(1, Math.abs(i.formality - target) / 3)) * 0.4;
    if (s > best.s) best = { s, i };
  }
  return best.i;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Formality target for a free text occasion. */
export function occasionFormality(occasion: string): number {
  const o = occasion.toLowerCase();
  if (/wedding|reception|gala|black tie|interview|sangeet/.test(o)) return 5;
  if (/office|work|meeting|client|presentation|stand out/.test(o)) return 4;
  if (/date|dinner|party|brunch|cafe/.test(o)) return 3;
  if (/gym|run|home|lounge|sleep|errand/.test(o)) return 1;
  return 2;
}
