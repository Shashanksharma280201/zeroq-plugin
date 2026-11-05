import { COLOR_HEX, guessColors } from "./classify.ts";
import { findDuplicates, findPairs } from "./match.ts";
import type { Category, ClassifiedProduct, WardrobeItem } from "./types.ts";

/**
 * The Zero Q score.
 *
 * The AI never picks the number. It reports facts about the item (its
 * colours, how dressy it is) and answers fixed questions about you (which of
 * your likes and dislikes it hits, a 1-5 style and shape rating against
 * written anchors). This file turns those into a score out of 100, the same
 * way every time, and keeps a receipt of where every point came from.
 *
 *   score = weighted mean of the parts that apply
 *           + adjustments (budget)
 *           then capped by the safety rules (never wear, go-easy colour, near twin)
 */

export const WEIGHTS = {
  colour: 0.3,
  style: 0.3,
  shape: 0.15,
  wardrobe: 0.15,
  occasion: 0.1,
} as const;

export const CAPS = {
  never: 25,
  avoidColour: 45,
  twin: 40,
} as const;

export const BUDGET_PENALTY = 10;

export type PartKey = keyof typeof WEIGHTS;

export interface Swatch {
  name: string;
  hex: string;
}

/** What the score needs to know about you. */
export interface ScoreProfile {
  best: Swatch[];
  avoid: Swatch[];
  likes: string[];
  dislikes: string[];
  never?: string;
  formality: { usual: number; range: [number, number] };
  useFrame: boolean;
  budget?: string;
}

/** What the AI (or the text prefilter) reports about one item. */
export interface ItemFacts {
  category: Category | string;
  /** Main colour first. */
  colors: Swatch[];
  /** 1 lounge to 5 formal */
  formality: number;
  /** 1-5 against the anchors in STYLE_ANCHORS; null when unknown */
  styleFit: number | null;
  /** 1-5 against SHAPE_ANCHORS; null when unknown or frame not used */
  shapeFit: number | null;
  /** indexes into profile.likes / profile.dislikes */
  likesMatched: number[];
  dislikesMatched: number[];
  never: boolean;
  price?: number;
}

/** What the score needs to know about your wardrobe. */
export interface WardrobeFacts {
  size: number;
  pairs: number;
  /** 0-1, the strongest look-alike you own */
  twin: number;
  twinName?: string;
}

export interface PartResult {
  key: PartKey;
  label: string;
  weight: number;
  value: number;
  /** points this part adds to the final score, after re-weighting */
  points: number;
  why: string;
}

export interface ScoreResult {
  score: number;
  verdict: Verdict;
  parts: PartResult[];
  /** applied caps, strongest first */
  caps: Array<{ reason: string; cap: number }>;
  adjustments: Array<{ reason: string; delta: number }>;
  /** the weighted mean before adjustments and caps */
  raw: number;
}

export type Verdict = "Made for you" | "Good on you" | "Could work" | "Not quite you" | "Skip it";

export const STYLE_ANCHORS = `1 = clashes with how I dress; 2 = not my taste; 3 = neutral, could go either way; 4 = clearly my taste; 5 = exactly what I keep choosing`;
export const SHAPE_ANCHORS = `1 = works against my frame; 2 = unflattering; 3 = neutral; 4 = flattering; 5 = exactly the cut that suits my frame`;

export function verdictFor(score: number): Verdict {
  return score >= 90 ? "Made for you" : score >= 75 ? "Good on you" : score >= 55 ? "Could work" : score >= 35 ? "Not quite you" : "Skip it";
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const likert = (n: number | null) => (n == null || !Number.isFinite(n) ? null : clamp(Math.round(n), 1, 5));

// ---------- the parts ----------

/** Colour: measured. Distance from the item's colours to your best and go-easy swatches. */
export function colourPart(colors: Swatch[], best: Swatch[], avoid: Swatch[]): { value: number; avoidHit: Swatch | null; near: Swatch | null; why: string } | null {
  const hexes = colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex));
  if (!hexes.length || !best.length) return null;
  const one = (c: Swatch) => {
    const dBest = Math.min(...best.map((b) => deltaE(c.hex, b.hex)));
    const nearIdx = best.findIndex((b) => deltaE(c.hex, b.hex) === dBest);
    // Within ~8 is the same colour to most eyes; lose 2 points per unit beyond.
    let v = dBest <= 8 ? 100 : 100 - (dBest - 8) * 2;
    if (isNeutral(c.hex)) v = Math.max(v, 70); // neutrals sit with almost anything
    v = clamp(v, 20, 100);
    const avoidHit = avoid.find((a) => deltaE(c.hex, a.hex) < 14) ?? null;
    if (avoidHit) v = Math.min(v, 30);
    return { v, avoidHit, near: dBest < 18 ? best[nearIdx] : null };
  };
  const main = one(hexes[0]);
  const second = hexes[1] ? one(hexes[1]) : null;
  const value = Math.round(second ? main.v * 0.75 + second.v * 0.25 : main.v);
  const avoidHit = main.avoidHit ?? second?.avoidHit ?? null;
  const why = avoidHit
    ? `${hexes[0].name || "This colour"} is close to your go-easy ${avoidHit.name.toLowerCase()}`
    : main.near
      ? `${hexes[0].name || "The colour"} is close to your ${main.near.name.toLowerCase()}`
      : isNeutral(hexes[0].hex)
        ? `${hexes[0].name || "A neutral"} works with your palette`
        : `${hexes[0].name || "This colour"} is outside your palette`;
  return { value, avoidHit, near: main.near, why };
}

export function stylePart(styleFit: number | null, likes: number, dislikes: number): { value: number; why: string } | null {
  const l = likert(styleFit);
  if (l == null && likes === 0 && dislikes === 0) return null;
  const base = l == null ? 50 : 25 * (l - 1);
  const value = clamp(base + 8 * Math.min(2, likes) - 25 * Math.min(2, dislikes));
  const why = dislikes ? `Hits ${dislikes === 1 ? "one thing" : `${dislikes} things`} you avoid` : likes ? `Matches ${likes === 1 ? "one thing" : `${likes} things`} you like` : l != null && l >= 4 ? "Clearly your taste" : l != null && l <= 2 ? "Not your taste" : "Neutral for your style";
  return { value, why };
}

export function shapePart(shapeFit: number | null, useFrame: boolean): { value: number; why: string } | null {
  const l = likert(shapeFit);
  if (!useFrame || l == null) return null;
  return { value: 25 * (l - 1), why: l >= 4 ? "The cut suits your frame" : l <= 2 ? "The cut works against your frame" : "Neutral cut for you" };
}

export function wardrobePart(w: WardrobeFacts): { value: number; why: string } | null {
  if (w.size === 0) return null;
  let value = clamp(35 + 16 * Math.min(w.pairs, 4));
  if (w.twin >= 0.95) value = Math.min(value, 20);
  else if (w.twin >= 0.85) value = clamp(value - 20);
  const why = w.twin >= 0.85 ? `Close to your ${w.twinName?.toLowerCase() ?? "own piece"}` : w.pairs ? `Goes with ${w.pairs} thing${w.pairs === 1 ? "" : "s"} you own` : "Nothing you own goes with it yet";
  return { value, why };
}

export function occasionPart(formality: number, range: [number, number]): { value: number; why: string } {
  const f = clamp(Math.round(formality || 3), 1, 5);
  const gap = f < range[0] ? range[0] - f : f > range[1] ? f - range[1] : 0;
  const value = gap === 0 ? 100 : gap === 1 ? 60 : 25;
  return { value, why: gap === 0 ? "As dressy as you usually go" : f > range[1] ? "Dressier than you usually go" : "More casual than you usually go" };
}

/** Upper limit of a budget answer such as "₹1,500 to 3,000" or "Under ₹1,500". "₹6,000+" has none. */
export function budgetMax(budget?: string): number | null {
  if (!budget || /\+\s*$/.test(budget)) return null;
  const nums = (budget.match(/[\d,]+/g) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => n > 0);
  return nums.length ? Math.max(...nums) : null;
}

// ---------- the score ----------

const LABEL: Record<PartKey, string> = { colour: "Colour on you", style: "Your style", shape: "Shape for you", wardrobe: "With your wardrobe", occasion: "Your occasions" };

export function scoreItem(item: ItemFacts, profile: ScoreProfile, wardrobe: WardrobeFacts): ScoreResult {
  const c = colourPart(item.colors, profile.best, profile.avoid);
  const st = stylePart(item.styleFit, item.likesMatched.length, item.dislikesMatched.length);
  const sh = shapePart(item.shapeFit, profile.useFrame);
  const wd = wardrobePart(wardrobe);
  const oc = occasionPart(item.formality, profile.formality.range);

  const present: Array<[PartKey, { value: number; why: string } | null]> = [
    ["colour", c],
    ["style", st],
    ["shape", sh],
    ["wardrobe", wd],
    ["occasion", oc],
  ];
  const used = present.filter((p): p is [PartKey, { value: number; why: string }] => p[1] != null);
  // Parts that do not apply (no wardrobe yet, frame switched off) hand their
  // weight to the others in proportion, so a score is always out of 100.
  const total = used.reduce((s, [k]) => s + WEIGHTS[k], 0) || 1;
  const parts: PartResult[] = used.map(([key, p]) => {
    const weight = WEIGHTS[key] / total;
    return { key, label: LABEL[key], weight, value: Math.round(p.value), points: p.value * weight, why: p.why };
  });
  const raw = parts.reduce((s, p) => s + p.points, 0);

  const adjustments: ScoreResult["adjustments"] = [];
  const max = budgetMax(profile.budget);
  if (max && item.price && item.price > max * 1.5) adjustments.push({ reason: `Well over your usual ${profile.budget}`, delta: -BUDGET_PENALTY });

  const caps: ScoreResult["caps"] = [];
  if (item.never) caps.push({ reason: "On your never-wear list", cap: CAPS.never });
  if (c?.avoidHit) caps.push({ reason: `Close to your go-easy ${c.avoidHit.name.toLowerCase()}`, cap: CAPS.avoidColour });
  if (wardrobe.twin >= 0.95) caps.push({ reason: `You own a near twin${wardrobe.twinName ? `: your ${wardrobe.twinName.toLowerCase()}` : ""}`, cap: CAPS.twin });
  caps.sort((a, b) => a.cap - b.cap);

  let score = raw + adjustments.reduce((s, a) => s + a.delta, 0);
  if (caps.length) score = Math.min(score, caps[0].cap);
  score = Math.round(clamp(score));
  return { score, verdict: verdictFor(score), parts, caps, adjustments, raw: Math.round(raw) };
}

// ---------- wardrobe facts from the existing matcher ----------

export function wardrobeFacts(product: Pick<ClassifiedProduct, "category" | "kind" | "colors" | "formality" | "name">, wardrobe: WardrobeItem[], extra: WardrobeItem[] = []): WardrobeFacts {
  const all = [...wardrobe, ...extra];
  const dups = findDuplicates(product, wardrobe);
  return { size: wardrobe.length, pairs: findPairs(product, all).length, twin: dups[0]?.score ?? 0, twinName: dups[0]?.item.name };
}

// ---------- the free text-only prefilter ----------

/**
 * Facts from a product's text alone (name, colour words, description), for
 * ranking a whole catalogue before any photo is sent to the AI. Style is
 * judged by word overlap with your likes and dislikes; shape is unknown.
 */
export function textFacts(p: ClassifiedProduct, profile: ScoreProfile): ItemFacts {
  const text = `${p.name} ${p.color ?? ""} ${p.description ?? ""}`.toLowerCase();
  const hits = (phrases: string[]) => phrases.map((ph, i) => (phraseHit(text, ph) ? i : -1)).filter((i) => i >= 0);
  const colorNames = p.colors.length ? p.colors : guessColors(text);
  return {
    category: p.category,
    colors: colorNames.filter((n) => COLOR_HEX[n]).map((n) => ({ name: cap(n), hex: COLOR_HEX[n] })),
    formality: p.formality,
    styleFit: null,
    shapeFit: null,
    likesMatched: hits(profile.likes),
    dislikesMatched: hits(profile.dislikes),
    never: profile.never ? profile.never.split(/[,;]| and /).map((s) => s.trim()).filter((s) => s.length > 2).some((ph) => phraseHit(text, ph)) : false,
    price: p.price,
  };
}

const STOP = new Set(["with", "that", "your", "the", "and", "for", "fits", "fit", "tops", "pieces", "clothes", "wear", "colours", "colors", "no", "very"]);
/** A phrase hits when its distinctive words appear (e.g. "skinny jeans" in "Skinny fit stretch jeans"). */
function phraseHit(text: string, phrase: string): boolean {
  const words = phrase.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return false;
  const found = words.filter((w) => new RegExp(`\\b${w.replace(/s$/, "")}`).test(text)).length;
  return found === words.length || (words.length >= 3 && found >= words.length - 1);
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- colour maths ----------

export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export function isNeutral(hex: string): boolean {
  const [l, a, b] = lab(hex);
  const chroma = Math.hypot(a, b);
  // Greys, black, white, off-whites, beiges and deep navy all behave as neutrals.
  return chroma < 14 || (l < 25 && chroma < 30);
}

function lab(hex: string): [number, number, number] {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92));
  const x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047;
  const y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

