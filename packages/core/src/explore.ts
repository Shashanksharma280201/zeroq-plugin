import { colourNames } from "./classify.ts";
import type { Category, WardrobeItem } from "./types.ts";

/**
 * Explore: what is new for you. Everything you own or have searched is
 * "familiar"; a piece is new when its colour, its kind or its price is
 * outside that. Explore shows new pieces that still suit you.
 */

export type NewBecause = "colour" | "category" | "budget";

export interface Familiar {
  colours: Set<string>;
  /** how often each kind of piece shows up in what you own and search */
  categories: Map<string, number>;
  /** the top of your usual budget, if you set one */
  budgetMax?: number;
  total: number;
}

export function familiarFrom(
  wardrobe: Pick<WardrobeItem, "category" | "colors">[],
  searched: Array<{ category?: string; colors?: Array<string | { name?: string; hex?: string }> }>,
  budgetMax?: number,
): Familiar {
  const colours = new Set<string>();
  const categories = new Map<string, number>();
  const seeCat = (c?: string) => c && categories.set(c, (categories.get(c) ?? 0) + 1);
  for (const w of wardrobe) { w.colors.forEach((c) => colours.add(c)); seeCat(w.category); }
  for (const s of searched) { colourNames(s.colors).forEach((c) => colours.add(c)); seeCat(s.category); }
  return { colours, categories, budgetMax, total: wardrobe.length + searched.length };
}

export interface Novelty {
  because: NewBecause[];
  /** 0..1: how far outside your usual it sits */
  score: number;
}

export function noveltyOf(p: { category: Category | string; colors: string[]; price?: number }, f: Familiar): Novelty {
  const because: NewBecause[] = [];
  const named = p.colors.filter(Boolean);
  if (named.length && named.every((c) => !f.colours.has(c))) because.push("colour");
  const seen = f.categories.get(p.category) ?? 0;
  // "rare" scales with how much history there is: 0 of 40 is new, 1 of 40 still nearly new
  if (p.category !== "other" && seen <= Math.floor(f.total / 40)) because.push("category");
  if (f.budgetMax && p.price && p.price > f.budgetMax) because.push("budget");
  const weight = { colour: 0.4, category: 0.4, budget: 0.25 };
  return { because, score: Math.min(1, because.reduce((s, b) => s + weight[b], 0)) };
}

export const NEW_LABEL: Record<NewBecause, string> = {
  colour: "New colour for you",
  category: "Something you never try",
  budget: "Above your usual budget",
};
