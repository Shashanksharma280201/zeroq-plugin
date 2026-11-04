import type { WardrobeItem } from "@zq/core";
import { askClaude, imagePart, parseJson, type Content } from "./ai.ts";
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
}

export interface Rating {
  score: number;
  verdict: "Made for you" | "Good on you" | "Could work" | "Not quite you" | "Skip it";
  headline: string;
  item: { name: string; category: string; color: string; hex: string };
  colour: Part;
  shape: Part;
  style: Part;
  wardrobe: { pairsWith: string[]; note: string };
  occasions: string[];
  watchOut?: string;
}

interface Part {
  score: number;
  note: string;
}

// ---------- storage ----------

export async function getProfile(): Promise<StyleProfile | null> {
  const s = await chrome.storage.local.get("profile");
  return (s.profile as StyleProfile) ?? null;
}
export async function saveProfile(p: StyleProfile): Promise<void> {
  await chrome.storage.local.set({ profile: p });
}
export async function clearProfile(): Promise<void> {
  await chrome.storage.local.remove("profile");
  for (let i = 0; i < 8; i++) await deleteBlob(`outfit:${i}`);
}
export function onProfile(fn: (p: StyleProfile | null) => void): () => void {
  const h = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && "profile" in c) fn((c.profile.newValue as StyleProfile) ?? null);
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
I mostly shop for: ${answers.shopFor.join(", ") || "not said"}. Usual budget per piece: ${answers.budget || "not said"}. I never wear: ${answers.never || "not said"}.

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
  const raw = parseJson<any>(await askClaude(PROFILER, content, 1600));
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

const RATER = `You are this person's personal stylist. You know their taste profile and their wardrobe. Rate how well one item suits THEM specifically, not how nice it is in general. Be honest: a beautiful item that is not them should score low. Never comment on fit or size; that is decided in a trial room. Plain words, no emoji. Reply with JSON only.`;

export async function rateItem(opts: {
  image: Blob;
  pageTitle?: string;
  pageUrl?: string;
  hint?: string;
  profile: StyleProfile;
  wardrobe: WardrobeItem[];
}): Promise<Rating> {
  const p = opts.profile;
  const frame = p.answers.useFrame ? `Frame: ${p.frame}. Flatters: ${p.flatters.join("; ")}.` : "Do not use body or frame in the rating.";
  const wardrobe = opts.wardrobe.slice(0, 80).map((i) => `${i.id}: ${i.name} (${i.category}, ${i.colors.join("+") || "?"})`).join("\n");
  const text = await askClaude(
    RATER,
    [
      await imagePart(opts.image, 896),
      {
        type: "text",
        text: `The item is the main clothing piece in this image${opts.hint ? ` (${opts.hint})` : ""}. Page: ${opts.pageTitle ?? ""} ${opts.pageUrl ?? ""}

MY PROFILE
Style: ${p.styleName}. ${p.summary}
Words: ${p.styleWords.join(", ")}. Undertone: ${p.undertone}.
Colours that suit me: ${p.palette.best.map((s) => s.name).join(", ")}. Avoid: ${p.palette.avoid.map((s) => s.name).join(", ")}.
I like: ${p.likes.join("; ")}. I avoid: ${p.dislikes.join("; ")}.
${frame}
Usual formality ${p.formality.usual} of 5. Shop for: ${p.answers.shopFor.join(", ")}. Never: ${p.answers.never || "-"}.

MY WARDROBE (id: item)
${wardrobe || "(empty)"}

Return JSON:
{"score": 0-100 overall fit to me,
 "verdict": "Made for you" (90+) | "Good on you" (75-89) | "Could work" (55-74) | "Not quite you" (35-54) | "Skip it" (<35),
 "headline": one sentence verdict in my terms,
 "item": {"name": short name, "category": top|bottom|one-piece|outerwear|footwear|accessory, "color": colour name, "hex": its main colour},
 "colour": {"score": 0-100, "note": one sentence},
 "shape": {"score": 0-100, "note": one sentence about cut and proportion for me},
 "style": {"score": 0-100, "note": one sentence about how it matches my taste},
 "wardrobe": {"pairsWith": up to 3 ids from my wardrobe, "note": one sentence},
 "occasions": up to 3 short occasions I would wear it to,
 "watchOut": optional one sentence}`,
      },
    ],
    900,
  );
  return normaliseRating(parseJson<any>(text), new Set(opts.wardrobe.map((i) => i.id)));
}

export function normaliseRating(r: any, ids: Set<string>): Rating {
  const score = clamp(r.score, 0, 100, 50);
  const verdict: Rating["verdict"] =
    score >= 90 ? "Made for you" : score >= 75 ? "Good on you" : score >= 55 ? "Could work" : score >= 35 ? "Not quite you" : "Skip it";
  const part = (x: any): Part => ({ score: clamp(x?.score, 0, 100, 50), note: String(x?.note ?? "") });
  return {
    score,
    verdict,
    headline: String(r.headline ?? ""),
    item: { name: String(r.item?.name ?? "This item"), category: String(r.item?.category ?? "top"), color: String(r.item?.color ?? ""), hex: hex(r.item?.hex, "#888888") },
    colour: part(r.colour),
    shape: part(r.shape),
    style: part(r.style),
    wardrobe: { pairsWith: list(r.wardrobe?.pairsWith, 3).filter((id: string) => ids.has(id)), note: String(r.wardrobe?.note ?? "") },
    occasions: list(r.occasions, 3),
    watchOut: r.watchOut ? String(r.watchOut) : undefined,
  };
}
