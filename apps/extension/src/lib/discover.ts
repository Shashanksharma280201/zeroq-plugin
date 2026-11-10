import {
  bestOutfit, classifyProduct, colourNames, guessColors, noveltyOf, familiarFrom, budgetMax, scoreItem, textFacts, wardrobeFacts, NEW_LABEL,
  type Category, type ClassifiedProduct, type NewBecause, type WardrobeItem,
} from "@zq/core";
import { readCatalog } from "./catalog.ts";
import { getMeta, listItems, setMeta } from "./db.ts";
import { getMemory, itemKeyOf, listRated, type RatedEntry } from "./events.ts";
import { srcToBlob } from "./images.ts";
import { getProfile, rateItems, scoreProfile } from "./profile.ts";

/**
 * New from the stores you visit.
 *
 * Zero Q goes back to the stores in your history, reads what they sell now,
 * leaves out everything you have already looked at or own, and keeps the
 * pieces that make a complete outfit with your wardrobe and with the pieces
 * you searched and liked. It is slow on purpose: it reads politely, one store
 * at a time, and the best few get a real score from their photos.
 */

export interface StoreVisit {
  origin: string;
  name: string;
  visits: number;
  last: string;
}

/** A searched piece standing in as part of an outfit. */
export interface SearchedPiece {
  id: string;
  itemKey: string;
  name: string;
  url?: string;
  src?: string;
  thumbKey?: string;
  hex?: string;
  category: string;
}

export interface Look {
  id: string;
  product: ClassifiedProduct;
  store: string;
  score: number;
  /** true when the score came from the photo, not just the listing text */
  ai: boolean;
  why: string;
  labels: string[];
  /** wardrobe item ids that complete the outfit */
  wardrobe: string[];
  /** searched pieces that complete it */
  searched: SearchedPiece[];
}

export interface Discovery {
  looks: Look[];
  stores: Array<{ name: string; origin: string; read: number; ok: boolean }>;
  at: string;
}

export interface DiscoverProgress {
  stage: "reading" | "choosing" | "scoring" | "done";
  store?: string;
  done: number;
  total: number;
}

const KEY = "discovery";
const MAX_STORES = 5;
const SHORTLIST = 10;
const BATCH = 5;
export const DISCOVERY_TTL = 24 * 60 * 60 * 1000;
const SEARCHED = "s:";

const storeName = (origin: string) => {
  const h = new URL(origin).hostname.replace(/^www\./, "").split(".")[0];
  return h.charAt(0).toUpperCase() + h.slice(1);
};

/** The stores in your history, most visited first. */
export function visitedStores(rated: Array<Pick<RatedEntry, "url" | "ts">>, max = MAX_STORES): StoreVisit[] {
  const by = new Map<string, StoreVisit>();
  for (const r of rated) {
    let origin: string;
    try { const u = new URL(r.url ?? ""); if (!/^https?:$/.test(u.protocol)) continue; origin = u.origin; } catch { continue; }
    const s = by.get(origin) ?? { origin, name: storeName(origin), visits: 0, last: r.ts };
    s.visits++;
    if (r.ts > s.last) s.last = r.ts;
    by.set(origin, s);
  }
  return [...by.values()].sort((a, b) => b.visits - a.visits || b.last.localeCompare(a.last)).slice(0, max);
}

/** Searched pieces you liked and have not bought, shaped like wardrobe items so outfits can use them. */
export function searchedAsItems(rated: RatedEntry[]): { items: WardrobeItem[]; byId: Map<string, SearchedPiece> } {
  const items: WardrobeItem[] = [];
  const byId = new Map<string, SearchedPiece>();
  for (const r of rated) {
    if (r.bought || r.hidden || r.score < 70 || !r.category || r.category === "other") continue;
    const id = SEARCHED + r.itemKey;
    const names = colourNames(r.colors);
    items.push({ id, name: r.name, category: r.category as Category, colors: names.length ? names : guessColors(r.name), formality: r.formality ?? 3, source: "product-page", createdAt: r.ts, wornCount: 0 });
    byId.set(id, { id, itemKey: r.itemKey, name: r.name, url: r.url, src: r.src, thumbKey: r.thumbKey, hex: r.hex, category: r.category });
    if (items.length >= 30) break;
  }
  return { items, byId };
}

export async function cachedDiscovery(): Promise<Discovery | null> {
  return (await getMeta<Discovery>(KEY)) ?? null;
}

export async function discover(opts: { signal?: AbortSignal; onProgress?: (p: DiscoverProgress) => void; useAI?: boolean } = {}): Promise<Discovery> {
  const [profile, wardrobe, rated, memory] = await Promise.all([getProfile(), listItems(), listRated(), getMemory()]);
  const stores = visitedStores(rated);
  if (!stores.length) throw new Error("Ask about a few pieces on any store first. Zero Q then goes back to those stores for you.");
  const say = (p: DiscoverProgress) => opts.onProgress?.(p);
  const cancelled = () => { if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };

  // 1. read each store
  const seen = new Set<string>([...rated.map((r) => r.itemKey), ...wardrobe.map((w) => (w.sourceUrl ? itemKeyOf(w.sourceUrl) : "")).filter(Boolean)]);
  const read: Discovery["stores"] = [];
  const fresh: Array<{ product: ClassifiedProduct; store: string }> = [];
  for (const [i, s] of stores.entries()) {
    cancelled();
    say({ stage: "reading", store: s.name, done: i, total: stores.length });
    try {
      const cat = await readCatalog(s.origin, { signal: opts.signal });
      const name = cat.brand || s.name;
      let n = 0;
      for (const d of cat.products) {
        if (seen.has(itemKeyOf(d.url)) || !d.images.length) continue;
        const product = classifyProduct(d);
        if (product.category === "other") continue;
        fresh.push({ product, store: name });
        n++;
      }
      read.push({ name, origin: s.origin, read: cat.products.length, ok: cat.products.length > 0 });
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      read.push({ name: s.name, origin: s.origin, read: 0, ok: false });
    }
  }

  // 2. keep what suits you and completes an outfit
  say({ stage: "choosing", done: 0, total: fresh.length });
  const liked = searchedAsItems(rated);
  const closet = [...wardrobe, ...liked.items];
  const sp = profile ? scoreProfile(profile) : null;
  const fam = familiarFrom(wardrobe, rated, (profile ? budgetMax(profile.answers.budget) : undefined) ?? undefined);
  const pool = fresh.map(({ product, store }) => {
    const pre = sp ? scoreItem(textFacts(product, sp), sp, wardrobeFacts(product, wardrobe, liked.items)).score : 60;
    const outfit = bestOutfit(product, closet);
    const novelty = noveltyOf(product, fam);
    return { product, store, pre, outfit, novelty, rank: pre + 6 * outfit.pieces.length + 8 * novelty.score };
  }).filter((c) => c.pre >= 55 && c.outfit.pieces.length > 0).sort((a, b) => b.rank - a.rank);
  // variety: no store and no kind of piece takes over
  const perStore = new Map<string, number>(), perCat = new Map<string, number>();
  const short = pool.filter((c) => {
    const s = perStore.get(c.store) ?? 0, k = perCat.get(c.product.category) ?? 0;
    if (s >= 4 || k >= 3) return false;
    perStore.set(c.store, s + 1); perCat.set(c.product.category, k + 1);
    return true;
  }).slice(0, SHORTLIST);

  // 3. a real score for the shortlist, from the photos
  const looks: Look[] = [];
  const aiPicks = new Map<string, string[]>();
  const scored = new Map<string, { score: number; why: string }>();
  if (opts.useAI !== false && profile && short.length) {
    for (let i = 0; i < short.length; i += BATCH) {
      cancelled();
      say({ stage: "scoring", done: i, total: short.length });
      const group = short.slice(i, i + BATCH);
      const images = await Promise.all(group.map((g) => srcToBlob(g.product.images[0], 512).catch(() => null)));
      const ok = group.filter((_, k) => images[k]);
      if (!ok.length) continue;
      const ratings = await rateItems({
        items: ok.map((g) => ({ image: images[group.indexOf(g)]!, hint: `${g.product.name}${g.product.price ? `, INR ${g.product.price}` : ""}`, price: g.product.price })),
        profile, wardrobe, extra: liked.items, memory,
      }).catch(() => ok.map(() => null));
      ok.forEach((g, k) => {
        const r = ratings[k];
        if (!r) return;
        scored.set(g.product.url, { score: r.score, why: r.headline });
        aiPicks.set(g.product.url, r.wardrobe.pairsWith);
      });
    }
  }
  for (const c of short) {
    const ai = scored.get(c.product.url);
    const outfit = ai ? bestOutfit(c.product, closet, aiPicks.get(c.product.url) ?? []) : c.outfit;
    if (!outfit.pieces.length) continue;
    const score = ai?.score ?? c.pre;
    if (score < 60) continue;
    const names = outfit.pieces.map((p) => p.name.toLowerCase());
    looks.push({
      id: itemKeyOf(c.product.url),
      product: c.product,
      store: c.store,
      score,
      ai: !!ai,
      why: ai?.why ?? `Goes with your ${names.slice(0, 2).join(" and ")}.`,
      labels: c.novelty.because.map((b: NewBecause) => NEW_LABEL[b]),
      wardrobe: outfit.pieces.filter((p) => !p.id.startsWith(SEARCHED)).map((p) => p.id),
      searched: outfit.pieces.filter((p) => p.id.startsWith(SEARCHED)).map((p) => liked.byId.get(p.id)!).filter(Boolean),
    });
  }
  looks.sort((a, b) => b.score - a.score);
  const out: Discovery = { looks: looks.slice(0, 8), stores: read, at: new Date().toISOString() };
  await setMeta(KEY, out);
  say({ stage: "done", done: out.looks.length, total: out.looks.length });
  return out;
}
