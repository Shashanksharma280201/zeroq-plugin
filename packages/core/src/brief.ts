import { COLORS, guessColors, guessKind } from "./classify.ts";
import type { Category, ClassifiedProduct } from "./types.ts";

/**
 * "Find it for me": you say what you are looking for, Zero Q finds options and
 * ends on one to buy.
 *
 * This file holds the thinking that needs no browser and no AI: turning typed
 * words into a brief, checking a product against it, loosening the brief when
 * nothing fits, and choosing the one piece to buy out of several good ones.
 */

export interface Brief {
  /** the kind of piece, as classify.ts names it: "shirt", "jeans", "sneakers" */
  kind?: string;
  /** colour names, see COLORS */
  colors: string[];
  /** the most you want to pay */
  max?: number;
  /** other words that matter: "linen", "oversized" */
  words: string[];
}

export const emptyBrief = (): Brief => ({ colors: [], words: [] });
export const briefIsEmpty = (b: Brief) => !b.kind && !b.colors.length && !b.words.length;

/** The kinds offered as one-tap choices, most searched first. */
export const KIND_CHOICES: Array<{ kind: string; label: string; category: Category }> = [
  { kind: "t-shirt", label: "T-shirt", category: "top" },
  { kind: "shirt", label: "Shirt", category: "top" },
  { kind: "jeans", label: "Jeans", category: "bottom" },
  { kind: "trousers", label: "Trousers", category: "bottom" },
  { kind: "kurta", label: "Kurta", category: "top" },
  { kind: "dress", label: "Dress", category: "one-piece" },
  { kind: "top", label: "Top", category: "top" },
  { kind: "hoodie", label: "Hoodie", category: "outerwear" },
  { kind: "jacket", label: "Jacket", category: "outerwear" },
  { kind: "sweater", label: "Sweater", category: "outerwear" },
  { kind: "cargo", label: "Cargos", category: "bottom" },
  { kind: "shorts", label: "Shorts", category: "bottom" },
  { kind: "joggers", label: "Joggers", category: "bottom" },
  { kind: "skirt", label: "Skirt", category: "bottom" },
  { kind: "set", label: "Co-ord set", category: "one-piece" },
  { kind: "polo", label: "Polo", category: "top" },
  { kind: "blazer", label: "Blazer", category: "outerwear" },
  { kind: "sneakers", label: "Sneakers", category: "footwear" },
  { kind: "sandals", label: "Sandals", category: "footwear" },
  { kind: "accessory", label: "Accessory", category: "accessory" },
];
const LABEL = new Map(KIND_CHOICES.map((k) => [k.kind, k.label]));
export const kindLabel = (kind?: string) => (kind ? LABEL.get(kind) ?? kind.charAt(0).toUpperCase() + kind.slice(1) : "");
const plural = (label: string) => (/(ss|sh|ch|x)$/i.test(label) ? `${label}es` : /s$/i.test(label) ? label : `${label}s`);

/** Colours close enough to stand in for one another when the exact one is not on sale. */
const NEAR: Record<string, string[]> = {
  blue: ["navy", "denim"], navy: ["blue", "denim"], denim: ["blue", "navy"],
  white: ["cream"], cream: ["white", "beige"], beige: ["cream", "brown"], brown: ["beige", "maroon"],
  green: ["olive"], olive: ["green"], red: ["maroon"], maroon: ["red", "brown"],
  pink: ["purple"], purple: ["pink"], yellow: ["orange"], orange: ["yellow"], black: ["grey"], grey: ["black"],
};

const FILLER = new Set([
  "a", "an", "the", "for", "me", "my", "i", "im", "want", "need", "looking", "look", "find", "show", "get", "some", "something", "any", "good", "nice", "new",
  "in", "on", "with", "and", "or", "of", "to", "wear", "that", "is", "are", "it", "this", "please", "buy", "under", "below", "less", "than", "upto", "up",
  "max", "within", "around", "about", "budget", "price", "rs", "inr", "rupees", "rupee", "colour", "color", "coloured", "colored", "men", "mens", "women", "womens", "man", "woman", "guys", "girls",
]);

const num = (s: string, k?: string) => Math.round(Number(s.replace(/,/g, "")) * (k ? 1000 : 1));

/** Reads a price ceiling out of typed words: "under 800", "below ₹1,500", "1000 to 2000", "2k". */
function priceIn(text: string): { max?: number; rest: string } {
  const money = String.raw`(?:rs\.?|inr|₹)?\s*([\d][\d,]*(?:\.\d+)?)\s*(k\b)?`;
  const range = new RegExp(String.raw`${money}\s*(?:-|–|to)\s*${money}`, "i").exec(text);
  if (range) return { max: Math.max(num(range[1], range[2] ?? range[4]), num(range[3], range[4])), rest: text.replace(range[0], " ") };
  const capped = new RegExp(String.raw`(?:under|below|less than|upto|up to|max|maximum|within|budget(?: of)?|<)\s*${money}`, "i").exec(text);
  if (capped) return { max: num(capped[1], capped[2]), rest: text.replace(capped[0], " ") };
  const bare = /(?:rs\.?|inr|₹)\s*([\d][\d,]*)\s*(k\b)?|([\d][\d,]*)\s*(k\b)?\s*(?:rs\b|rupees?|inr)|\b(\d{1,2})\s*(k)\b/i.exec(text);
  if (bare) return { max: bare[1] ? num(bare[1], bare[2]) : bare[3] ? num(bare[3], bare[4]) : num(bare[5], "k"), rest: text.replace(bare[0], " ") };
  return { rest: text };
}

/** Turns what you typed ("black oversized tee under 800") into a brief. */
export function parseBrief(text: string): Brief {
  const { max, rest } = priceIn(text.toLowerCase());
  const kind = guessKind(rest).kind;
  const colors = guessColors(rest);
  // what is left once the kind words, the colour words and the small words are taken out
  const colourWords = new Set(COLORS.flatMap((c) => c.words.flatMap((w) => w.split(/[\s-]+/))));
  const words = [...new Set((rest.match(/[a-z][a-z-]+/g) ?? []).filter((w) => w.length > 2 && !FILLER.has(w) && !colourWords.has(w) && !guessKind(w).kind))];
  return { kind, colors, max: max && max >= 100 ? max : undefined, words: words.slice(0, 6) };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The brief in a few words: "Olive or navy shirts under ₹1,500". */
export function briefLabel(b: Brief): string {
  const what = b.kind ? plural(kindLabel(b.kind)).toLowerCase() : "pieces";
  const head = [list(b.colors), b.words.join(" "), what].filter(Boolean).join(" ");
  return cap(`${head}${b.max ? ` under ${inr(b.max)}` : ""}`);
}

/** What to type into a store's own search box. */
export function briefQuery(b: Brief): string {
  return [b.colors[0], ...b.words, b.kind ? kindLabel(b.kind).toLowerCase() : ""].filter(Boolean).join(" ").trim();
}

export interface BriefMatch {
  kind: boolean;
  /** "exact", "near" (a close colour), "no", or "unknown" when the listing names no colour */
  colour: "exact" | "near" | "no" | "unknown" | "any";
  /** null when the listing has no price */
  price: boolean | null;
  /** how many of the extra words the listing mentions */
  words: number;
}

/** How one product stands against the brief. */
export function matchBrief(p: Pick<ClassifiedProduct, "name" | "kind" | "category" | "colors" | "price" | "description" | "color">, b: Brief): BriefMatch {
  const text = `${p.name} ${p.color ?? ""} ${p.description ?? ""}`.toLowerCase();
  const kind = !b.kind || p.kind === b.kind || (b.kind === "accessory" && p.category === "accessory");
  let colour: BriefMatch["colour"] = "any";
  if (b.colors.length) {
    const has = p.colors.length ? p.colors : guessColors(text);
    colour = !has.length ? "unknown" : has.some((c) => b.colors.includes(c)) ? "exact" : has.some((c) => b.colors.some((w) => NEAR[w]?.includes(c))) ? "near" : "no";
  }
  const price = b.max ? (p.price == null ? null : p.price <= b.max) : true;
  const words = b.words.filter((w) => text.includes(w)).length;
  return { kind, colour, price, words };
}

export type Loosened = null | "colour" | "price";

/**
 * The products that fit the brief. Fewer than three exact fits are filled out
 * with close colours. When nothing fits exactly, the brief is loosened one step
 * at a time and the result says how: first a close colour is allowed in place
 * of the exact one (a budget is a harder line than a shade), then a price up
 * to a fifth over.
 */
export function fitBrief<T extends Pick<ClassifiedProduct, "name" | "kind" | "category" | "colors" | "price" | "description" | "color">>(products: T[], b: Brief): { fits: Array<{ product: T; match: BriefMatch }>; loosened: Loosened } {
  const all = products.map((product) => ({ product, match: matchBrief(product, b) })).filter((x) => x.match.kind);
  const priced = all.filter((x) => x.match.price !== false);
  const exact = priced.filter((x) => x.match.colour === "exact" || x.match.colour === "any");
  const near = priced.filter((x) => x.match.colour === "near" || x.match.colour === "unknown");
  // a couple of exact fits is a thin choice: close colours fill it out, ranked behind them
  if (exact.length) return { fits: exact.length < 3 ? [...exact, ...near] : exact, loosened: null };
  if (near.length) return { fits: near, loosened: "colour" };
  if (b.max) {
    const stretch = all.filter((x) => x.match.colour !== "no" && x.product.price != null && x.product.price <= b.max! * 1.2);
    if (stretch.length) return { fits: stretch, loosened: "price" };
  }
  return { fits: [], loosened: null };
}

/** Order among fits before any photo is looked at: how well it suits you, then how closely it meets the brief. */
export function briefRank(match: BriefMatch, suits: number, outfitPieces: number): number {
  return suits + 6 * Math.min(outfitPieces, 3) + 4 * match.words + (match.colour === "exact" ? 6 : match.colour === "near" ? 2 : 0) + (match.price === true ? 2 : 0);
}

// ---------- one to buy ----------

export interface Candidate {
  id: string;
  score: number;
  price?: number;
  /** how many pieces you own that it goes with */
  pairs: number;
  /** when you looked at it */
  ts?: string;
}

export interface OnePick<T extends Candidate> {
  pick: T;
  /** short reasons, strongest first */
  why: string[];
  /** how many were in the running */
  outOf: number;
}

const DAY = 864e5;

/**
 * Out of several pieces worth buying, the one to buy. The score leads; being
 * inside your budget and going with more of what you own break near ties, and
 * so does the lower price. Returns null when nothing is good enough to say
 * "buy this".
 */
export function oneToBuy<T extends Candidate>(candidates: T[], opts: { budget?: number | null; minScore?: number; withinDays?: number; now?: number; skip?: string[] } = {}): OnePick<T> | null {
  const min = opts.minScore ?? 75;
  const now = opts.now ?? Date.now();
  const pool = candidates.filter((c) => c.score >= min && !opts.skip?.includes(c.id) && (!opts.withinDays || !c.ts || now - Date.parse(c.ts) <= opts.withinDays * DAY));
  if (!pool.length) return null;
  const budget = opts.budget ?? null;
  const over = (c: T) => (budget && c.price ? Math.max(0, c.price / budget - 1) : 0);
  const worth = (c: T) => c.score + Math.min(c.pairs, 3) * 1.5 - Math.min(12, over(c) * 30);
  const ranked = [...pool].sort((a, b) => worth(b) - worth(a) || (a.price ?? Infinity) - (b.price ?? Infinity));
  const pick = ranked[0], next = ranked[1];
  const why: string[] = [];
  if (pool.length > 1 && pick.score === Math.max(...pool.map((c) => c.score))) why.push(`Highest score of the ${pool.length}`);
  if (budget && pick.price) why.push(pick.price <= budget ? (pick.price < budget ? `${inr(budget - pick.price)} under your budget` : "On your budget") : `${inr(pick.price - budget)} over your budget`);
  if (pick.pairs > 0) why.push(`Goes with ${pick.pairs} of yours`);
  if (next && pick.price && next.price && pick.price < next.price && pick.score >= next.score - 2) why.push(`${inr(next.price - pick.price)} less than the next best`);
  return { pick, why: why.slice(0, 3), outOf: pool.length };
}
