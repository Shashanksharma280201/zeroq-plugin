import {
  NEW_LABEL, budgetMax, classifyProduct, colourNames, familiarFrom, memoryBlock, noveltyOf, scoreItem, textFacts, wardrobeFacts,
  type Category, type ClassifiedProduct, type NewBecause, type WardrobeItem,
} from "@zq/core";
import { askAI, parseJson } from "./ai.ts";
import type { Catalog } from "./catalog.ts";
import { getMeta, listItems, setMeta } from "./db.ts";
import { getMemory, listRated } from "./events.ts";
import { srcToBlob } from "./images.ts";
import { getProfile, rateItems, scoreProfile, type Rating } from "./profile.ts";

/**
 * Explore: something new, on purpose. Ideas sit outside your usual budget,
 * outside what you usually search and outside what you own, while still
 * suiting your colouring and taste. Never breaks your "never" list.
 */

export interface Idea {
  id: string;
  title: string;
  /** one short line: why it suits you and why it is new */
  why: string;
  kind: "colour" | "category" | "style" | "budget" | "occasion";
  hex?: string;
  category: Category;
  /** what to type into a store's search */
  query: string;
  /** a rough price, e.g. "₹2,500 to 4,000" */
  price?: string;
}

export interface Ideas {
  ideas: Idea[];
  at: string;
}

/** Store searches. Plain search pages, opened in a new tab: no scraping, nothing sent anywhere. */
export const STORES: Array<{ name: string; url: (q: string) => string }> = [
  { name: "Myntra", url: (q) => `https://www.myntra.com/${encodeURIComponent(q.trim().toLowerCase().replace(/\s+/g, "-"))}?rawQuery=${encodeURIComponent(q)}` },
  { name: "Ajio", url: (q) => `https://www.ajio.com/search/?text=${encodeURIComponent(q)}` },
  { name: "Amazon", url: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}` },
  { name: "Flipkart", url: (q) => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}` },
];

const DAY = 864e5;

export async function cachedIdeas(): Promise<Ideas | null> {
  return (await getMeta<Ideas>("exploreIdeas")) ?? null;
}

export async function exploreIdeas(force = false): Promise<Ideas> {
  const hit = await cachedIdeas();
  if (!force && hit && Date.now() - Date.parse(hit.at) < DAY) return hit;
  const [profile, wardrobe, rated, memory] = await Promise.all([getProfile(), listItems(), listRated(), getMemory()]);
  if (!profile) throw new Error("Set up your style first.");
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing yet";
  const owned = `Categories: ${count(wardrobe.map((w) => w.category))}. Colours: ${count(wardrobe.flatMap((w) => w.colors))}.`;
  const searched = `Categories: ${count(rated.map((r) => r.category ?? "other"))}. Colours: ${count(rated.flatMap((r) => colourNames(r.colors)))}. Brands: ${count(rated.map((r) => r.brand ?? "").filter(Boolean))}. Prices: ${rated.map((r) => r.price).filter(Boolean).slice(0, 20).join(", ") || "unknown"}.`;
  const text = await askAI(
    "You are a stylist who helps one person discover new things. You suggest pieces they would not find on their own, that still suit them. Plain words, no emoji. JSON only.",
    [{
      type: "text",
      text: `MY STYLE: ${profile.styleName}. ${profile.summary}
Colours that suit me: ${profile.palette.best.map((c) => `${c.name} ${c.hex}`).join(", ")}. Go easy on: ${profile.palette.avoid.map((c) => c.name).join(", ") || "none"}.
Likes: ${profile.likes.join("; ")}. Dislikes: ${profile.dislikes.join("; ")}. NEVER suggest: ${profile.answers.never || "nothing listed"}.
Usual budget per piece: ${profile.answers.budget ?? "not set"}. I shop for: ${profile.answers.shopFor.join(", ") || "everyday"}.

WHAT I OWN: ${owned}
WHAT I SEARCH: ${searched}
${memoryBlock(memory, profile.answers.budget)}

Suggest 6 things that are NEW for me, each different in kind:
- 2 in a colour I neither own nor search, from my suiting colours or right next to them
- 2 kinds of piece I never search or own (a category, a cut or a fabric)
- 1 worth going above my usual budget for, and say why it lasts
- 1 for an occasion or style I have not explored
Each must still suit me. Never anything from my NEVER list. Use words for the right section (men's or women's) if my style makes it clear.
For each: a short title (under 6 words), one line why (under 16 words, say what is new about it), kind, a hex for its main colour, a category (top, bottom, one-piece, outerwear, footwear, accessory), a store search query of 3 to 6 words, and a rough price range in rupees.
Return {"ideas": [{"title": "", "why": "", "kind": "colour|category|style|budget|occasion", "hex": "#rrggbb", "category": "", "query": "", "price": ""}]}`,
    }],
    { maxTokens: 1400, json: true, temperature: 0.8 },
  );
  const raw = parseJson<any>(text);
  const CATS = ["top", "bottom", "one-piece", "outerwear", "footwear", "accessory"];
  const ideas: Idea[] = (Array.isArray(raw) ? raw : raw.ideas ?? [])
    .filter((i: any) => i?.title && i?.query)
    .slice(0, 6)
    .map((i: any, n: number) => ({
      id: `${Date.now().toString(36)}${n}`,
      title: String(i.title).slice(0, 60),
      why: String(i.why ?? "").slice(0, 140),
      kind: ["colour", "category", "style", "budget", "occasion"].includes(i.kind) ? i.kind : "style",
      hex: /^#[0-9a-f]{6}$/i.test(i.hex ?? "") ? i.hex : undefined,
      category: (CATS.includes(i.category) ? i.category : "other") as Category,
      query: String(i.query).slice(0, 80),
      price: i.price ? String(i.price).slice(0, 40) : undefined,
    }));
  const out = { ideas, at: new Date().toISOString() };
  await setMeta("exploreIdeas", out);
  return out;
}

// ---------- new for you at this brand ----------

export interface NewPick {
  product: ClassifiedProduct;
  score: number;
  because: NewBecause[];
  labels: string[];
  rating?: Rating;
}

/**
 * The brand's products that are new for you and still suit you: scored from
 * their text with the usual formula (budget set aside), ranked by how new
 * they are, then the best few scored properly with their photos.
 */
export async function exploreBrand(catalog: Catalog, opts: { useAI: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<NewPick[]> {
  const [profile, wardrobe, rated] = await Promise.all([getProfile(), listItems(), listRated()]);
  const sp = profile ? { ...scoreProfile(profile), budget: undefined } : null;
  const fam = familiarFrom(wardrobe, rated, (profile ? budgetMax(profile.answers.budget) : undefined) ?? undefined);
  const pool: NewPick[] = [];
  for (const d of catalog.products) {
    const product = classifyProduct(d);
    const n = noveltyOf(product, fam);
    if (!n.because.length) continue;
    const fit = sp ? scoreItem(textFacts(product, sp), sp, wardrobeFacts(product, wardrobe as WardrobeItem[])).score : 60;
    if (fit < 50) continue;
    pool.push({ product, score: fit, because: n.because, labels: n.because.map((b) => NEW_LABEL[b]) });
  }
  // newest first, then best fit, with some variety: at most 3 of one category
  pool.sort((a, b) => b.because.length - a.because.length || b.score - a.score);
  const perCat = new Map<string, number>();
  const picks = pool.filter((p) => {
    const c = perCat.get(p.product.category) ?? 0;
    perCat.set(p.product.category, c + 1);
    return c < 3;
  }).slice(0, 10);

  if (opts.useAI && profile && picks.length) {
    const top = picks.slice(0, 6);
    opts.onProgress?.(0, top.length);
    const images = await Promise.all(top.map((p) => (p.product.images[0] ? srcToBlob(p.product.images[0], 640).catch(() => null) : null)));
    const ok = top.filter((_, i) => images[i]);
    if (ok.length) {
      const ratings = await rateItems({
        items: ok.map((p) => ({ image: images[top.indexOf(p)]!, hint: [p.product.brand, p.product.name].filter(Boolean).join(" "), price: p.product.price })),
        profile,
        wardrobe,
      }).catch(() => ok.map(() => null));
      ok.forEach((p, i) => { if (ratings[i]) { p.rating = ratings[i]!; p.score = ratings[i]!.score; } });
    }
    opts.onProgress?.(top.length, top.length);
  }
  return picks.sort((a, b) => b.score - a.score);
}
