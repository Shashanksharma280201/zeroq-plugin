import {
  PAIRS_WITH, STRETCH_PER_LIST, budgetMax, classifyProduct, colorHarmony, colourPart, isStretchPick, scoreItem, stretchFor, textFacts, wardrobeFacts,
  type ClassifiedProduct, type DetectedProduct, type ItemFacts, type Stretch, type TasteMemory, type WardrobeFacts, type WardrobeItem,
} from "@zq/core";
import type { Catalog } from "./catalog.ts";
import { srcToBlob } from "./images.ts";
import { rateItems, scoreProfile, type Rating, type StyleProfile } from "./profile.ts";

/**
 * Shopping a whole brand for you, in two passes:
 *  1. Every product in the catalogue is scored from its text alone with the
 *     same formula (colour words, type, price, your likes and dislikes, your
 *     wardrobe). This costs nothing.
 *  2. Only the best ~18 are sent to the AI with their photos, six at a time,
 *     and get a real score.
 */

export interface Pick {
  product: ClassifiedProduct;
  pre: number;
  rating?: Rating;
  /** the score to show: the AI-backed one when we have it */
  score: number;
  reason: string;
  facts?: ItemFacts;
  wf?: WardrobeFacts;
  /** set when it breaks a soft limit but your history says you would like it */
  stretch?: Stretch;
}

export interface ShopResult {
  brand: string;
  origin: string;
  read: number;
  better: Pick[];
  withIt: Pick[];
  alsoForYou: Pick[];
  /** at most 2, outside your usual budget, occasion or colours */
  stretch: Pick[];
  owned: Pick[];
  stats: { inPalette: number; withinBudget: number | null; priceMin?: number; priceMax?: number; categories: Array<[string, number]> };
  aiScored: boolean;
}

export const SELECTED_ID = "selected";
const BATCH = 6;
const PER_GROUP = 6;

export async function shopBrand(opts: {
  catalog: Catalog;
  selected: DetectedProduct | null;
  selectedScore?: number;
  profile: StyleProfile | null;
  wardrobe: WardrobeItem[];
  useAI: boolean;
  memory?: TasteMemory | null;
  stretchPicks?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<ShopResult> {
  const { catalog, profile, wardrobe } = opts;
  const sel = opts.selected ? classifyProduct(opts.selected) : null;
  const selItem: WardrobeItem[] = sel
    ? [{ id: SELECTED_ID, name: sel.name, category: sel.category, kind: sel.kind, colors: sel.colors, formality: sel.formality, source: "product-page", createdAt: new Date().toISOString(), wornCount: 0 }]
    : [];
  const sp = profile ? scoreProfile(profile) : null;

  // ---------- pass 1: everything, from text ----------
  const all: Pick[] = catalog.products
    .filter((p) => !sel || p.url.split("?")[0] !== sel.url.split("?")[0])
    .map((p) => classifyProduct(p))
    .filter((p) => p.category !== "other" && p.images.length)
    .map((product) => {
      const wf = wardrobeFacts(product, wardrobe, selItem);
      const facts = sp ? textFacts(product, sp) : undefined;
      const r = sp && facts
        ? scoreItem(facts, sp, wf)
        : { score: Math.round(40 + 12 * Math.min(wf.pairs, 4) - (wf.twin >= 0.85 ? 40 : 0)), parts: [], caps: [] as Array<{ reason: string }> };
      const reason = r.caps[0]?.reason ?? (wf.twin >= 0.85 ? `Like your ${wf.twinName?.toLowerCase()}` : wf.pairs ? `Goes with ${wf.pairs} of yours` : "");
      return { product, pre: r.score, score: r.score, reason, facts, wf };
    });

  // Your look-alikes: things you already own. Shown so you can skip them.
  const owned = all.filter((p) => wardrobeFacts(p.product, wardrobe).twin >= 0.85).sort((a, b) => b.pre - a.pre).slice(0, 4);
  const ownedSet = new Set(owned.map((o) => o.product.url));
  const pool = all.filter((p) => !ownedSet.has(p.product.url)).sort((a, b) => b.pre - a.pre);

  const same = sel ? pool.filter((p) => p.product.category === sel.category) : [];
  const partners = sel ? new Set(PAIRS_WITH[sel.category] ?? []) : new Set<string>();
  const withSel = (p: Pick) => (sel ? colorHarmony(sel.colors, p.product.colors).score : 0);
  const comp = sel ? pool.filter((p) => partners.has(p.product.category)).sort((a, b) => b.pre + 20 * withSel(b) - (a.pre + 20 * withSel(a))) : [];
  const chosen = new Set<string>();
  const take = (list: Pick[], n: number) => list.filter((p) => !chosen.has(p.product.url)).slice(0, n).map((p) => (chosen.add(p.product.url), p));
  let better = take(same, PER_GROUP);
  let withIt = take(comp, PER_GROUP);
  // The rest: the best of the brand, one or two per category so it is not all shirts.
  const perCat = new Map<string, number>();
  let also = take(
    pool.filter((p) => {
      const n = perCat.get(p.product.category) ?? 0;
      if (n >= 2) return false;
      perCat.set(p.product.category, n + 1);
      return true;
    }),
    sel ? PER_GROUP : 3 * PER_GROUP,
  );

  // Outside your usual: from what is left, the pieces your history would rescue.
  const stretchOf = (p: Pick, base?: Rating) =>
    sp && opts.stretchPicks !== false && (base?.facts ?? p.facts) ? stretchFor(base?.facts ?? p.facts!, sp, base?.wf ?? p.wf!, opts.memory ?? null, base) : null;
  let stretch = pool
    .filter((p) => !chosen.has(p.product.url))
    .map((p) => ((p.stretch = stretchOf(p) ?? undefined), p))
    .filter((p) => p.stretch && p.stretch.score > p.pre)
    .sort((a, b) => b.stretch!.score - a.stretch!.score)
    .slice(0, STRETCH_PER_LIST * 2);
  for (const p of stretch) chosen.add(p.product.url);

  // ---------- pass 2: the shortlist, with photos ----------
  let aiScored = false;
  if (opts.useAI && profile) {
    const shortlist = [...better, ...withIt, ...also, ...stretch];
    let done = 0;
    opts.onProgress?.(0, shortlist.length);
    for (let i = 0; i < shortlist.length; i += BATCH) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const group = shortlist.slice(i, i + BATCH);
      const images = await Promise.all(group.map((g) => srcToBlob(g.product.images[0], 512).catch(() => null)));
      const ok = group.filter((_, k) => images[k]);
      const ratings = ok.length
        ? await rateItems({
            items: ok.map((g, k) => ({ image: images[group.indexOf(g)]!, hint: `${g.product.name}${g.product.price ? `, ${g.product.currency ?? "INR"} ${g.product.price}` : ""}`, price: g.product.price })),
            profile,
            wardrobe,
            extra: selItem,
            memory: opts.memory,
          }).catch(() => ok.map(() => null))
        : [];
      ok.forEach((g, k) => {
        const r = ratings[k];
        if (r) {
          g.rating = r;
          g.score = r.score;
          g.reason = r.headline;
        }
      });
      done += group.length;
      opts.onProgress?.(done, shortlist.length);
      aiScored = aiScored || ratings.some(Boolean);
    }
  }

  const byScore = (a: Pick, b: Pick) => b.score - a.score;
  const floor = opts.selectedScore ?? 0;
  // Same-type alternatives worth a look; the ones that beat yours say so.
  better = better.filter((p) => p.score >= Math.min(70, floor || 70)).sort(byScore);
  if (floor) for (const p of better) if (p.score > floor) p.reason = `Beats yours by ${p.score - floor}. ${p.reason}`;
  withIt = withIt
    .filter((p) => p.score >= 55)
    .sort((a, b) => Number(b.rating?.wardrobe.pairsWith.includes(SELECTED_ID) ?? false) - Number(a.rating?.wardrobe.pairsWith.includes(SELECTED_ID) ?? false) || byScore(a, b));
  also = also.filter((p) => p.score >= 55).sort(byScore);
  stretch = stretch
    .map((p) => {
      if (p.rating) p.stretch = stretchOf(p, p.rating) ?? undefined;
      return p;
    })
    .filter((p) => isStretchPick(p.stretch ?? null))
    .sort((a, b) => b.stretch!.score - a.stretch!.score)
    .slice(0, STRETCH_PER_LIST);
  for (const p of stretch) p.reason = p.stretch!.reasons[0].label;

  // ---------- the brand at a glance ----------
  const coloured = all.filter((p) => p.product.colors.length);
  const inPalette = profile && coloured.length
    ? Math.round((100 * coloured.filter((p) => (colourPart(textFacts(p.product, sp!).colors, profile.palette.best, profile.palette.avoid)?.value ?? 0) >= 80).length) / coloured.length)
    : 0;
  const prices = all.map((p) => p.product.price).filter((n): n is number => !!n).sort((a, b) => a - b);
  const max = sp ? budgetMax(sp.budget) : null;
  const cats = new Map<string, number>();
  for (const p of all) cats.set(p.product.category, (cats.get(p.product.category) ?? 0) + 1);

  return {
    brand: catalog.brand,
    origin: catalog.origin,
    read: catalog.products.length,
    better,
    withIt,
    alsoForYou: also,
    stretch,
    owned,
    stats: {
      inPalette,
      withinBudget: max && prices.length ? Math.round((100 * prices.filter((p) => p <= max).length) / prices.length) : null,
      priceMin: prices[0],
      priceMax: prices[prices.length - 1],
      categories: [...cats.entries()].sort((a, b) => b[1] - a[1]),
    },
    aiScored,
  };
}
