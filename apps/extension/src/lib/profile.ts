import {
  CATEGORIES, SHAPE_ANCHORS, STYLE_ANCHORS, describeEvent, detailsBlock, guessColors, guessKind, memoryBlock, scoreItem, wardrobeFacts,
  type Category, type ItemFacts, type MySizes, type PageRead, type PartKey, type ProductDetails, type ScoreProfile, type ScoreResult, type TasteMemory, type WardrobeFacts, type WardrobeItem, type ZQEvent,
} from "@zq/core";
import { logEvent, outfitPhotoHashes } from "./events.ts";
import { askAI, imagePart, parseJson, type Content } from "./ai.ts";
import { getBlob, putBlob, deleteBlob } from "./db.ts";
import { downscale } from "./images.ts";

/**
 * Your style profile. Built once by Claude from 5 photos of outfits you love
 * plus a few taps, then used for every rating. Stored only in this browser.
 */
export interface Avatar {
  skin: string;
  hair: string;
  hairStyle: "buzz" | "short" | "wavy" | "long" | "bun" | "curly" | "covered";
  facialHair: "none" | "stubble" | "beard";
  glasses: boolean;
  build: "slim" | "average" | "athletic" | "broad" | "curvy";
  height: "short" | "average" | "tall";
  top: string;
  bottom: string;
  shoes: string;
  topStyle: "tee" | "shirt" | "kurta" | "jacket";
  bottomStyle: "trousers" | "jeans" | "skirt" | "shorts";
}

export interface StyleProfile {
  /** "You dress like..." two or three sentences, second person */
  summary: string;
  /** e.g. "Quiet minimal", three to five words */
  styleName: string;
  styleWords: string[];
  palette: { best: Swatch[]; avoid: Swatch[] };
  undertone: "warm" | "cool" | "neutral";
  likes: string[];
  dislikes: string[];
  /** Neutral, kind description of frame, e.g. "Tall with long legs" */
  frame: string;
  /** What flatters that frame */
  flatters: string[];
  fits: string[];
  formality: { usual: number; range: [number, number] };
  avatar: Avatar;
  answers: Answers;
  createdAt: string;
  /** last change, used to pick the newest profile across synced browsers */
  updatedAt?: string;
  photoCount: number;
}

export interface Swatch {
  name: string;
  hex: string;
}

export interface Answers {
  shopFor: string[];
  budget?: string;
  never?: string;
  useFrame: boolean;
  /** looks you tapped as yours during setup */
  looks?: string[];
  /** your usual sizes, so Zero Q can say whether yours is in stock */
  sizes?: MySizes;
}

/** A rating: facts from the AI, score from the formula in @zq/core/score.ts. */
export interface Rating extends ScoreResult {
  headline: string;
  item: { name: string; category: string; color: string; hex: string; colors: Swatch[] };
  /** The AI's one-line reading for each part, keyed by part */
  notes: Partial<Record<PartKey, string>>;
  wardrobe: { pairsWith: string[]; note: string };
  occasions: string[];
  watchOut?: string;
  /** what the formula was given, kept so the score can be re-run with your soft limits relaxed */
  facts: ItemFacts;
  wf: WardrobeFacts;
  /** what the AI read off the product page: fabric, sizing, reviews, value */
  page?: PageRead;
}

/** What the store's page says about the product being rated. */
export interface PageProduct {
  name?: string;
  brand?: string;
  price?: number;
  currency?: string;
  description?: string;
  color?: string;
  details?: ProductDetails;
}

// ---------- storage ----------

export async function getProfile(): Promise<StyleProfile | null> {
  const s = await chrome.storage.local.get("profile");
  return normalizeProfile(s.profile);
}

export const DEFAULT_AVATAR: Avatar = {
  skin: "#c69c7d", hair: "#2a211c", hairStyle: "short", facialHair: "none", glasses: false, build: "average", height: "average",
  top: "#2b3550", bottom: "#c9b99a", shoes: "#f2f0ea", topStyle: "tee", bottomStyle: "trousers",
};

const HEXRE = /^#[0-9a-f]{6}$/i;
const oneOf = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

/**
 * Profiles saved by older versions, cut-off AI answers or another browser can
 * miss fields. Fill every gap with a safe default so no screen can crash on it.
 */
export function normalizeProfile(raw: any): StyleProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const av = raw.avatar && typeof raw.avatar === "object" ? raw.avatar : {};
  const hex = (v: unknown, d: string) => (typeof v === "string" && HEXRE.test(v) ? v : d);
  const swatches = (v: unknown) => (Array.isArray(v) ? v.filter((x: any) => x && typeof x.hex === "string").map((x: any) => ({ name: String(x.name ?? ""), hex: hex(x.hex, "#999999") })) : []);
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const range = Array.isArray(raw.formality?.range) && raw.formality.range.length === 2 ? raw.formality.range.map(Number) : [2, 4];
  return {
    ...raw,
    styleName: String(raw.styleName ?? "Your style"),
    summary: String(raw.summary ?? ""),
    styleWords: strings(raw.styleWords),
    palette: { best: swatches(raw.palette?.best), avoid: swatches(raw.palette?.avoid) },
    likes: strings(raw.likes),
    dislikes: strings(raw.dislikes),
    flatters: strings(raw.flatters),
    fits: strings(raw.fits),
    formality: { usual: Number(raw.formality?.usual) || 3, range: range as [number, number] },
    answers: { shopFor: strings(raw.answers?.shopFor), useFrame: raw.answers?.useFrame !== false, ...raw.answers, ...(Array.isArray(raw.answers?.shopFor) ? {} : { shopFor: [] }) },
    avatar: {
      skin: hex(av.skin, DEFAULT_AVATAR.skin),
      hair: hex(av.hair, DEFAULT_AVATAR.hair),
      hairStyle: oneOf(av.hairStyle, ["buzz", "short", "wavy", "long", "bun", "curly", "covered"] as const, DEFAULT_AVATAR.hairStyle),
      facialHair: oneOf(av.facialHair, ["none", "stubble", "beard"] as const, "none"),
      glasses: !!av.glasses,
      build: oneOf(av.build, ["slim", "average", "athletic", "broad", "curvy"] as const, "average"),
      height: oneOf(av.height, ["short", "average", "tall"] as const, "average"),
      top: hex(av.top, DEFAULT_AVATAR.top),
      bottom: hex(av.bottom, DEFAULT_AVATAR.bottom),
      shoes: hex(av.shoes, DEFAULT_AVATAR.shoes),
      topStyle: oneOf(av.topStyle, ["tee", "shirt", "kurta", "jacket"] as const, "tee"),
      bottomStyle: oneOf(av.bottomStyle, ["trousers", "jeans", "skirt", "shorts"] as const, "trousers"),
    },
  } as StyleProfile;
}
export async function saveProfile(p: StyleProfile): Promise<void> {
  p = { ...p, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ profile: p });
  await logEvent("profile_built", { profile: p, photos: await outfitPhotoHashes() });
}
export async function clearProfile(): Promise<void> {
  await chrome.storage.local.remove("profile");
  for (let i = 0; i < 8; i++) await deleteBlob(`outfit:${i}`);
  await logEvent("profile_built", { profile: null, photos: [] });
}
export function onProfile(fn: (p: StyleProfile | null) => void): () => void {
  const h = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && "profile" in c) fn(normalizeProfile(c.profile.newValue));
  };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}
export async function saveOutfitPhotos(files: Blob[]) {
  for (let i = 0; i < files.length; i++) await putBlob(`outfit:${i}`, await downscale(files[i], 1024));
}
export async function getOutfitPhotos(): Promise<Blob[]> {
  const out: Blob[] = [];
  for (let i = 0; i < 8; i++) {
    const b = await getBlob(`outfit:${i}`);
    if (b) out.push(b);
  }
  return out;
}

// ---------- building the profile ----------

const PROFILER = `You are a perceptive personal stylist meeting a new client through photos of outfits they love wearing. You read taste, not just clothes: what they repeat, what they avoid, what colours sit well against their skin, what silhouettes they choose.
Rules:
- Speak to them in second person, warm and specific, no hype, no emoji.
- Describe their frame only in neutral, kind fashion terms (for example "tall with long legs", "broad shoulders, narrow hips", "petite and balanced"). Never mention weight, size numbers or anything that could feel like judgement.
- Infer, do not interrogate: they should feel understood without being asked about their body.
- Reply with JSON only.`;

export async function buildProfile(photos: Blob[], answers: Answers): Promise<StyleProfile> {
  const content: Content[] = [];
  for (const [i, p] of photos.entries()) {
    content.push({ type: "text", text: `Outfit ${i + 1}:` });
    content.push(await imagePart(p, 896));
  }
  content.push({
    type: "text",
    text: `These are my ${photos.length} favourite outfits.
I mostly shop for: ${answers.shopFor.join(", ") || "not said"}. Usual budget per piece: ${answers.budget || "not said"}. I never wear: ${answers.never || "not said"}.${answers.looks?.length ? ` Looks I picked as mine: ${answers.looks.join(", ")}.` : ""}

Return JSON with exactly these keys:
{
 "styleName": 2 to 4 words naming my style, sentence case,
 "summary": 2 sentences on how I dress and why it works,
 "styleWords": 3 to 5 single words,
 "palette": {"best": up to 6 {"name","hex"} colours I wear well or should try, "avoid": up to 3 {"name","hex"} that would wash me out or fight my look},
 "undertone": "warm" | "cool" | "neutral",
 "likes": 3 to 5 short phrases (fits, fabrics, details I keep choosing),
 "dislikes": 2 to 4 short phrases (things I clearly avoid),
 "frame": one neutral phrase,
 "flatters": 3 short phrases on cuts and proportions that suit my frame,
 "fits": 2 or 3 short phrases on how I like clothes to fit,
 "formality": {"usual": 1-5, "range": [min, max]} where 1 lounge, 3 smart casual, 5 formal,
 "avatar": {"skin": hex close to my skin tone, "hair": hex, "hairStyle": buzz|short|wavy|long|bun|curly|covered, "facialHair": none|stubble|beard, "glasses": true|false, "build": slim|average|athletic|broad|curvy, "height": short|average|tall, "top": hex of my signature top colour, "bottom": hex, "shoes": hex, "topStyle": tee|shirt|kurta|jacket, "bottomStyle": trousers|jeans|skirt|shorts}
}`,
  });
  const raw = parseJson<any>(await askAI(PROFILER, content, { maxTokens: 4000, json: true }));
  return normaliseProfile(raw, answers, photos.length);
}

const HEX = /^#[0-9a-f]{6}$/i;
const pick = <T extends string>(v: any, allowed: readonly T[], d: T): T => (allowed.includes(v) ? v : d);
const hex = (v: any, d: string) => (typeof v === "string" && HEX.test(v) ? v : d);
const list = (v: any, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n) : []);
const swatches = (v: any, n: number): Swatch[] =>
  Array.isArray(v) ? v.filter((s) => s && HEX.test(s.hex)).slice(0, n).map((s) => ({ name: String(s.name ?? ""), hex: s.hex })) : [];
const clamp = (n: any, lo: number, hi: number, d: number) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Math.round(Number(n)))) : d);

export function normaliseProfile(r: any, answers: Answers, photoCount: number): StyleProfile {
  const a = r.avatar ?? {};
  const range = Array.isArray(r.formality?.range) ? r.formality.range : [2, 4];
  return {
    styleName: String(r.styleName ?? "Your style"),
    summary: String(r.summary ?? ""),
    styleWords: list(r.styleWords, 5),
    palette: { best: swatches(r.palette?.best, 6), avoid: swatches(r.palette?.avoid, 3) },
    undertone: pick(r.undertone, ["warm", "cool", "neutral"] as const, "neutral"),
    likes: list(r.likes, 5),
    dislikes: list(r.dislikes, 4),
    frame: String(r.frame ?? ""),
    flatters: list(r.flatters, 3),
    fits: list(r.fits, 3),
    formality: { usual: clamp(r.formality?.usual, 1, 5, 3), range: [clamp(range[0], 1, 5, 2), clamp(range[1], 1, 5, 4)] },
    avatar: {
      skin: hex(a.skin, "#c99a78"),
      hair: hex(a.hair, "#2b211c"),
      hairStyle: pick(a.hairStyle, ["buzz", "short", "wavy", "long", "bun", "curly", "covered"] as const, "short"),
      facialHair: pick(a.facialHair, ["none", "stubble", "beard"] as const, "none"),
      glasses: a.glasses === true,
      build: pick(a.build, ["slim", "average", "athletic", "broad", "curvy"] as const, "average"),
      height: pick(a.height, ["short", "average", "tall"] as const, "average"),
      top: hex(a.top, "#2c3e66"),
      bottom: hex(a.bottom, "#cdb894"),
      shoes: hex(a.shoes, "#f2f2f2"),
      topStyle: pick(a.topStyle, ["tee", "shirt", "kurta", "jacket"] as const, "shirt"),
      bottomStyle: pick(a.bottomStyle, ["trousers", "jeans", "skirt", "shorts"] as const, "trousers"),
    },
    answers,
    createdAt: new Date().toISOString(),
    photoCount,
  };
}

// ---------- rating any item ----------

const RATER = `You are this person's personal stylist. You do not give scores. You report facts about the item and answer fixed questions about how it relates to this person, honestly and literally, so a formula can score it. Do not judge how it will fit my body; a trial room decides that. You may pass on what the store and its buyers say about sizing. Plain words, no emoji. Reply with JSON only.`;

export function scoreProfile(p: StyleProfile): ScoreProfile {
  return {
    best: p.palette.best,
    avoid: p.palette.avoid,
    likes: p.likes,
    dislikes: p.dislikes,
    never: p.answers.never,
    formality: p.formality,
    useFrame: p.answers.useFrame,
    budget: p.answers.budget,
  };
}

function profileBlock(p: StyleProfile): string {
  const frame = p.answers.useFrame ? `My frame: ${p.frame}. Cuts that flatter it: ${p.flatters.join("; ")}.` : "";
  return `MY PROFILE
Style: ${p.styleName}. ${p.summary}
Colours that suit me: ${p.palette.best.map((s) => s.name).join(", ")}. Go easy on: ${p.palette.avoid.map((s) => s.name).join(", ") || "-"}.
LIKES (by index): ${p.likes.map((l, i) => `[${i}] ${l}`).join("; ")}
DISLIKES (by index): ${p.dislikes.map((l, i) => `[${i}] ${l}`).join("; ")}
NEVER WEAR: ${p.answers.never || "-"}
${frame}`;
}

const PAGE_SCHEMA = `,
 "page": {"fabric": the fabric in a few words or null, "feel": one short phrase on how it wears (weight, breathability, stretch) or null,
  "fitType": "slim"|"regular"|"relaxed"|"oversized"|null, "season": "hot"|"mild"|"cold"|"all", "care": a few words or null,
  "quality": 1-5 from the fabric, the construction details and buyer reviews, null if there is nothing to go on,
  "reviewSummary": one sentence on what buyers say, null if there are no reviews,
  "sizeAdvice": one sentence from the store's sizing notes and reviews (for example that it runs small), null if nothing is said,
  "valueNote": one sentence on whether the price is fair for what it is}`;

const ITEM_SCHEMA = (useFrame: boolean, page = false) => `{"name": short name, "category": top|bottom|one-piece|outerwear|footwear|accessory,
 "colors": up to 3 [{"name": plain colour name, "hex": "#rrggbb" of the actual fabric colour}], main colour first,
 "formality": 1 lounge to 5 formal,
 "styleFit": 1-5 where ${STYLE_ANCHORS},
 "shapeFit": ${useFrame ? `1-5 where ${SHAPE_ANCHORS}` : "null"},
 "likesMatched": indexes of my LIKES this item clearly is, "dislikesMatched": indexes of my DISLIKES it clearly is,
 "never": true only if it is something on my NEVER WEAR list,
 "notes": {"colour": one sentence on this colour against my palette, "shape": one sentence on the cut for me, "style": one sentence on my taste},
 "pairsWith": up to 3 ids from my wardrobe it goes with, "wardrobeNote": one sentence,
 "occasions": up to 3 short occasions, "watchOut": optional one sentence${page ? PAGE_SCHEMA : ""}}`;

/** Your history for the AI: the taste memory plus the past events most like this item. */
function historyBlock(m: TasteMemory | null | undefined, p: StyleProfile, history?: ZQEvent[]): string {
  const block = memoryBlock(m ?? null, p.answers.budget);
  const lines = (history ?? []).map(describeEvent);
  if (!block && !lines.length) return "";
  return `\n${block}${lines.length ? `\nPAST ITEMS LIKE THIS ONE\n${lines.join("\n")}` : ""}
Use this history when answering styleFit and likes: what I bought, kept and rated up says more about my taste than my stated profile. It must not change "never".\n`;
}

function wardrobeBlock(wardrobe: WardrobeItem[]): string {
  return `MY WARDROBE (id: item)\n${wardrobe.slice(0, 80).map((i) => `${i.id}: ${i.name} (${i.category}, ${i.colors.join("+") || "?"})`).join("\n") || "(empty)"}`;
}

export async function rateItem(opts: {
  image: Blob;
  /** the same product from other angles */
  angles?: Blob[];
  pageTitle?: string;
  pageUrl?: string;
  hint?: string;
  price?: number;
  /** everything the product page says, when the item is the product on the page */
  product?: PageProduct;
  profile: StyleProfile;
  wardrobe: WardrobeItem[];
  memory?: TasteMemory | null;
  /** past events most like this item */
  history?: ZQEvent[];
}): Promise<Rating> {
  const p = opts.profile;
  const mem = historyBlock(opts.memory, p, opts.history);
  const page = opts.product ? detailsBlock(opts.product) : "";
  const text = await askAI(
    RATER,
    [
      await imagePart(opts.image, 896),
      ...(await Promise.all((opts.angles ?? []).slice(0, 3).map((b) => imagePart(b, 640)))),
      {
        type: "text",
        text: `The item is the main clothing piece in ${opts.angles?.length ? `these ${opts.angles.length + 1} images. They show the same product from different angles: use all of them for colour, fabric, cut and details` : "this image"}${opts.hint ? ` (${opts.hint})` : ""}. Page: ${opts.pageTitle ?? ""} ${opts.pageUrl ?? ""}

${page ? `\nPRODUCT PAGE (what the store says. Trust it over a guess from the photo for fabric, fit type, sizes and price. Use the photos for colour and cut.)\n${page}\n` : ""}
${profileBlock(p)}
${mem}
${wardrobeBlock(opts.wardrobe)}

Return JSON exactly in this shape:
${ITEM_SCHEMA(p.answers.useFrame, !!page)}`,
      },
    ],
    { maxTokens: page ? 2400 : 1600, json: true, temperature: 0 },
  );
  return toRating(parseJson<any>(text), p, opts.wardrobe, opts.price, [], opts.product?.details);
}

/**
 * Several items in one request (photos at a smaller size), for scanning a
 * brand. Returns ratings in the same order; an item the AI skipped is null.
 */
export async function rateItems(opts: {
  items: Array<{ image: Blob; hint: string; price?: number }>;
  profile: StyleProfile;
  wardrobe: WardrobeItem[];
  extra?: WardrobeItem[];
  memory?: TasteMemory | null;
}): Promise<Array<Rating | null>> {
  const p = opts.profile;
  const mem = historyBlock(opts.memory, p);
  const content: Content[] = [];
  for (const [i, it] of opts.items.entries()) {
    content.push({ type: "text", text: `ITEM ${i}: ${it.hint}` });
    content.push(await imagePart(it.image, 512));
  }
  content.push({
    type: "text",
    text: `${profileBlock(p)}
${mem}
${wardrobeBlock([...opts.wardrobe, ...(opts.extra ?? [])])}

For each ITEM above, report on the main clothing piece in its photo. Return JSON: {"items": [{"i": item number, ...fields}]} where fields are exactly:
${ITEM_SCHEMA(p.answers.useFrame)}`,
  });
  const raw = parseJson<any>(await askAI(RATER, content, { maxTokens: 900 * opts.items.length, json: true, temperature: 0 }));
  const list: any[] = Array.isArray(raw) ? raw : raw.items ?? [];
  return opts.items.map((it, i) => {
    const r = list.find((x) => Number(x?.i) === i) ?? list[i];
    return r ? toRating(r, p, opts.wardrobe, it.price, opts.extra) : null;
  });
}


/** AI facts in, formula out. */
export function toRating(r: any, p: StyleProfile, wardrobe: WardrobeItem[], price?: number, extra: WardrobeItem[] = [], details?: ProductDetails): Rating {
  const colors: Swatch[] = (Array.isArray(r.colors) ? r.colors : r.item?.colors ?? [])
    .filter((c: any) => c && HEX.test(c.hex))
    .slice(0, 3)
    .map((c: any) => ({ name: String(c.name ?? ""), hex: c.hex }));
  const name = String(r.name ?? r.item?.name ?? "This item");
  const category = String(r.category ?? r.item?.category ?? "top");
  const formality = Number(r.formality ?? r.item?.formality ?? 3) || 3;
  const idx = (v: any, n: number) => (Array.isArray(v) ? v.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < n) : []);
  const facts: ItemFacts = {
    category,
    colors,
    formality,
    styleFit: r.styleFit == null ? null : Number(r.styleFit),
    shapeFit: r.shapeFit == null ? null : Number(r.shapeFit),
    likesMatched: [...new Set(idx(r.likesMatched, p.likes.length))],
    dislikesMatched: [...new Set(idx(r.dislikesMatched, p.dislikes.length))],
    never: r.never === true,
    price,
    buyers: details?.rating && details.reviewCount ? { rating: details.rating, count: details.reviewCount } : undefined,
  };
  // Wardrobe facts come from the same matcher the rest of Zero Q uses.
  const basic = guessColors(colors.map((c) => c.name).join(" "));
  const kind = guessKind(name);
  const asProduct = { name, category: (CATEGORIES as readonly string[]).includes(category) ? (category as Category) : kind.category, kind: kind.kind, colors: basic, formality };
  const wf = wardrobeFacts(asProduct, wardrobe, extra);
  const result = scoreItem(facts, scoreProfile(p), wf);

  const notes: Rating["notes"] = { colour: r.notes?.colour, shape: r.notes?.shape, style: r.notes?.style };
  for (const k of Object.keys(notes) as PartKey[]) if (!notes[k]) delete notes[k];
  const ids = new Set([...wardrobe, ...extra].map((i) => i.id));
  const best = [...result.parts].sort((a, b) => b.value * b.weight - a.value * a.weight)[0];
  const worst = [...result.parts].sort((a, b) => a.value - b.value)[0];
  // Lead with what decided it: a cap, else your taste when it is good, else the weakest part.
  const lead = result.caps[0]?.reason ?? (result.score >= 55 ? notes.style ?? notes[best?.key] ?? best?.why : notes[worst?.key] ?? worst?.why) ?? "";
  return {
    ...result,
    headline: lead.endsWith(".") ? lead : `${lead}.`,
    item: { name, category, color: colors[0]?.name ?? "", hex: colors[0]?.hex ?? "#888888", colors },
    notes,
    wardrobe: { pairsWith: (Array.isArray(r.pairsWith) ? r.pairsWith : []).map(String).filter((id: string) => ids.has(id)).slice(0, 3), note: String(r.wardrobeNote ?? "") },
    occasions: (Array.isArray(r.occasions) ? r.occasions : []).map(String).slice(0, 3),
    watchOut: r.watchOut ? String(r.watchOut) : undefined,
    facts,
    wf,
    page: readPage(r.page),
  };
}

function readPage(v: any): PageRead | undefined {
  if (!v || typeof v !== "object") return undefined;
  const t = (x: any, n = 160) => (typeof x === "string" && x.trim() && !/^(null|none|n\/a|unknown)$/i.test(x.trim()) ? x.trim().slice(0, n) : undefined);
  const q = Number(v.quality);
  const page: PageRead = {
    fabric: t(v.fabric, 60), feel: t(v.feel, 80), fitType: t(v.fitType, 20), season: t(v.season, 10), care: t(v.care, 60),
    quality: Number.isFinite(q) && q >= 1 && q <= 5 ? Math.round(q) : undefined,
    reviewSummary: t(v.reviewSummary), sizeAdvice: t(v.sizeAdvice), valueNote: t(v.valueNote),
  };
  return Object.values(page).some((x) => x != null) ? page : undefined;
}
