import {
  bestOutfit, briefRank, classifyProduct, fitBrief, quickFacts, scoreItem, textFacts, wardrobeFacts,
  type Brief, type BriefMatch, type ClassifiedProduct, type Fact, type Loosened,
} from "@zq/core";
import { readCatalog } from "./catalog.ts";
import { searchedAsItems, visitedStores, type SearchedPiece, type StoreVisit } from "./discover.ts";
import { getMeta, listItems, setMeta } from "./db.ts";
import { getMemory, itemKeyOf, listRated } from "./events.ts";
import { srcToBlob } from "./images.ts";
import { getProfile, rateItems, scoreProfile } from "./profile.ts";

/**
 * Find it for me.
 *
 * You say what you are looking for: a kind of piece, colours, a price. Zero Q
 * reads what the stores you visit (and the store open beside it) sell right
 * now, keeps what fits the brief, orders it by how well it suits you and how
 * many outfits it makes with what you own, and gives the best few a real score
 * from their photos. The first one is the pick: the piece to buy.
 *
 * Polite like the rest of Zero Q's reading: only stores you have been to,
 * started by you, a few requests each, kept for half a day.
 */

export interface Option {
  id: string;
  product: ClassifiedProduct;
  store: string;
  score: number;
  /** true when the score came from the photo (or from an answer you already have), not only the listing text */
  ai: boolean;
  why: string;
  /** ticks and crosses: your style, your colour, the price against what you asked, what it goes with */
  facts: Fact[];
  /** wardrobe ids that complete the outfit */
  wardrobe: string[];
  /** searched pieces that complete it */
  searched: SearchedPiece[];
  colour: BriefMatch["colour"];
}

export interface Found {
  brief: Brief;
  options: Option[];
  /** how the brief was loosened to find anything, if it was */
  loosened: Loosened;
  stores: Array<{ name: string; origin: string; read: number; ok: boolean }>;
  /** pieces looked through, and how many fitted the brief */
  looked: number;
  fitted: number;
  at: string;
}

export interface FindProgress {
  stage: "reading" | "choosing" | "scoring" | "done";
  store?: string;
  done: number;
  total: number;
}

const KEY = "find";
const MAX_STORES = 6;
const SHORTLIST = 8;
const BATCH = 4;
const PER_STORE = 5;
const SEARCHED = "s:";

const storeName = (origin: string) => {
  const h = new URL(origin).hostname.replace(/^www\./, "").split(".")[0];
  return h.charAt(0).toUpperCase() + h.slice(1);
};

/** Where Zero Q will look: the store open beside it first, then the stores in your history. */
export async function findStores(origin?: string): Promise<StoreVisit[]> {
  const visited = visitedStores(await listRated(), MAX_STORES);
  if (!origin || !/^https?:/.test(origin) || visited.some((s) => s.origin === origin)) return visited;
  return [{ origin, name: storeName(origin), visits: 0, last: "" }, ...visited].slice(0, MAX_STORES);
}

export async function cachedFind(): Promise<Found | null> {
  return (await getMeta<Found>(KEY)) ?? null;
}

/** "Not for me": the option leaves the list, and the next one moves up. */
export async function dropOption(id: string): Promise<Found | null> {
  const f = await cachedFind();
  if (!f) return null;
  const next = { ...f, options: f.options.filter((o) => o.id !== id) };
  await setMeta(KEY, next);
  return next;
}

export async function find(brief: Brief, opts: { origin?: string; tabId?: number; signal?: AbortSignal; onProgress?: (p: FindProgress) => void; useAI?: boolean } = {}): Promise<Found> {
  const [profile, wardrobe, rated, memory, stores] = await Promise.all([getProfile(), listItems(), listRated(), getMemory(), findStores(opts.origin)]);
  if (!stores.length) throw new Error("Zero Q looks in the stores you have visited. Open a brand's store and ask about one piece, then come back.");
  const say = (p: FindProgress) => opts.onProgress?.(p);
  const cancelled = () => { if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };

  // 1. what the stores sell now, minus what you own, bought or waved away
  const gone = new Set<string>([
    ...rated.filter((r) => r.bought || r.hidden).map((r) => r.itemKey),
    ...wardrobe.map((w) => (w.sourceUrl ? itemKeyOf(w.sourceUrl) : "")).filter(Boolean),
  ]);
  const read: Found["stores"] = [];
  const shelf: Array<ClassifiedProduct & { store: string }> = [];
  for (const [i, s] of stores.entries()) {
    cancelled();
    say({ stage: "reading", store: s.name, done: i, total: stores.length });
    try {
      const cat = await readCatalog(s.origin, { signal: opts.signal, tabId: s.origin === opts.origin ? opts.tabId : undefined });
      const name = cat.brand || s.name;
      for (const d of cat.products) {
        if (!d.images.length || gone.has(itemKeyOf(d.url))) continue;
        shelf.push({ ...classifyProduct(d), store: name });
      }
      read.push({ name, origin: s.origin, read: cat.products.length, ok: cat.products.length > 0 });
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      read.push({ name: s.name, origin: s.origin, read: 0, ok: false });
    }
  }

  // 2. what fits the brief, best for you first
  say({ stage: "choosing", done: 0, total: shelf.length });
  const { fits, loosened } = fitBrief(shelf, brief);
  const liked = searchedAsItems(rated);
  const closet = [...wardrobe, ...liked.items];
  const sp = profile ? scoreProfile(profile) : null;
  // the price fact measures against what you asked for here, not your usual budget
  const budget = brief.max ? `Under ₹${brief.max}` : profile?.answers.budget;
  const ranked = fits.map(({ product, match }) => {
    const wf = wardrobeFacts(product, wardrobe, liked.items);
    const pre = sp ? scoreItem(textFacts(product, sp), sp, wf) : null;
    const outfit = bestOutfit(product, closet);
    return { product, match, wf, pre, outfit, rank: briefRank(match, pre?.score ?? 60, outfit.pieces.length) };
  }).filter((c) => !c.pre?.caps.some((x) => /never/i.test(x.reason))).sort((a, b) => b.rank - a.rank);
  const perStore = new Map<string, number>();
  const short = ranked.filter((c) => {
    const n = perStore.get(c.product.store) ?? 0;
    if (n >= PER_STORE) return false;
    perStore.set(c.product.store, n + 1);
    return true;
  }).slice(0, SHORTLIST);

  // 3. a real score: from an answer you already have, else from the photo
  const known = new Map(rated.map((r) => [r.itemKey, r]));
  const scored = new Map<string, { score: number; why: string; facts: Fact[]; pairs: string[] }>();
  const fresh = short.filter((c) => !known.has(itemKeyOf(c.product.url)));
  if (opts.useAI !== false && profile && fresh.length) {
    for (let i = 0; i < fresh.length; i += BATCH) {
      cancelled();
      say({ stage: "scoring", done: i, total: fresh.length });
      const group = fresh.slice(i, i + BATCH);
      const images = await Promise.all(group.map((g) => srcToBlob(g.product.images[0], 512).catch(() => null)));
      const ok = group.filter((_, k) => images[k]);
      if (!ok.length) continue;
      const ratings = await rateItems({
        items: ok.map((g) => ({ image: images[group.indexOf(g)]!, hint: `${g.product.name}${g.product.price ? `, INR ${g.product.price}` : ""}`, price: g.product.price })),
        profile, wardrobe, extra: liked.items, memory,
      }).catch(() => ok.map(() => null));
      ok.forEach((g, k) => {
        const r = ratings[k];
        if (r) scored.set(g.product.url, { score: r.score, why: r.headline, facts: quickFacts(r, r.wf, g.product.price, budget), pairs: r.wardrobe.pairsWith });
      });
    }
  }

  const options: Option[] = short.map((c) => {
    const id = itemKeyOf(c.product.url);
    const ai = scored.get(c.product.url), old = known.get(id);
    const outfit = ai ? bestOutfit(c.product, closet, ai.pairs) : old ? bestOutfit(c.product, closet, old.pairs) : c.outfit;
    const names = outfit.pieces.map((p) => p.name.toLowerCase());
    const { store, ...product } = c.product;
    return {
      id, product, store,
      score: ai?.score ?? old?.score ?? c.pre?.score ?? 60,
      ai: !!ai || !!old,
      why: ai?.why ?? (names.length ? `Goes with your ${names.slice(0, 2).join(" and ")}.` : c.pre?.parts.slice().sort((a, b) => b.points - a.points)[0]?.why ?? ""),
      facts: ai?.facts ?? (c.pre ? quickFacts(c.pre, c.wf, c.product.price, budget) : []),
      wardrobe: outfit.pieces.filter((p) => !p.id.startsWith(SEARCHED)).map((p) => p.id),
      searched: outfit.pieces.filter((p) => p.id.startsWith(SEARCHED)).map((p) => liked.byId.get(p.id)!).filter(Boolean),
      colour: c.match.colour,
    };
  });
  // A piece worth buying in the colour you asked for comes before a better score in a close colour:
  // you asked for blue. After those, the score decides.
  const tier = (o: Option) => (o.score < 75 ? 2 : o.colour === "exact" || o.colour === "any" ? 0 : 1);
  options.sort((a, b) => tier(a) - tier(b) || b.score - a.score || Number(b.ai) - Number(a.ai));

  const out: Found = { brief, options, loosened, stores: read, looked: shelf.length, fitted: fits.length, at: new Date().toISOString() };
  await setMeta(KEY, out);
  say({ stage: "done", done: options.length, total: options.length });
  return out;
}
