import { CATEGORIES, type Category, type ClassifiedProduct, type Outfit, type ProductCheck, type WardrobeItem } from "@zq/core";
import { blobToBase64, downscale } from "./images.ts";
import { getSettings, PROVIDER_NAME, type AIProvider, type Settings } from "./settings.ts";

/**
 * The AI layer. One function, askAI, sends a prompt (text plus photos) to
 * whichever provider is chosen in Settings: Gemini or Claude. Both are called
 * straight from the extension with your own key.
 * Every feature built on this has an offline fallback in @zq/core, so the
 * extension still works with no key at all.
 */

export class NoKeyError extends Error {
  constructor(provider: AIProvider) {
    super(`Add your ${PROVIDER_NAME[provider]} API key in Settings to use the stylist.`);
  }
}

/** Provider-neutral message parts. Images are base64 with a MIME type. */
export type Content =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: string };

export interface AskOptions {
  maxTokens?: number;
  /** Ask the provider to return JSON only (Gemini supports this natively) */
  json?: boolean;
  /** 0 for repeatable answers (ratings); default is the provider's own */
  temperature?: number;
}

/** Models that rejected a temperature setting this session; we stop sending it to them. */
const noTemperature = new Set<string>();

export async function askAI(system: string, content: Content[], opts: AskOptions = {}): Promise<string> {
  const s = await getSettings();
  const model = s.aiProvider === "claude" ? s.anthropicModel : s.geminiModel;
  const call = (o: AskOptions) => (s.aiProvider === "claude" ? askClaude(s, system, content, o) : askGemini(s, system, content, o));
  if (opts.temperature == null || noTemperature.has(model)) return call({ ...opts, temperature: undefined });
  try {
    return await call(opts);
  } catch (e: any) {
    // Newer models fix their own sampling and reject `temperature` with a 400.
    // Repeatability then comes from the formula, so drop it and ask again.
    if (/\(400\)/.test(e?.message ?? "") && /temperature/i.test(e?.message ?? "")) {
      noTemperature.add(model);
      return call({ ...opts, temperature: undefined });
    }
    throw e;
  }
}

// ---------- Claude ----------

async function askClaude(s: Settings, system: string, content: Content[], opts: AskOptions): Promise<string> {
  if (!s.anthropicKey) throw new NoKeyError("claude");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": s.anthropicKey,
      "anthropic-version": "2023-06-01",
      // Needed for calls from a browser. Safe here because the key is yours
      // and never leaves this browser except to Anthropic.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: s.anthropicModel,
      max_tokens: opts.maxTokens ?? 800,
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      system,
      messages: [{
        role: "user",
        content: content.map((c) => c.type === "text" ? c : { type: "image", source: { type: "base64", media_type: c.mime, data: c.data } }),
      }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("Anthropic rejected the API key. Check it in Settings.");
    if (res.status === 429) throw new Error("Claude is rate limiting you. Wait a minute and try again.");
    throw new Error(`Claude request failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

// ---------- Gemini ----------

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

export async function geminiCall(key: string, model: string, body: unknown): Promise<any> {
  const res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const msg: string = err?.error?.message ?? "";
    const status: string = err?.error?.status ?? "";
    if (res.status === 400 && /API key/i.test(msg)) throw new Error("Google rejected the Gemini API key. Check it in Settings.");
    if (res.status === 403) throw new Error("This Gemini key cannot use that model. Check billing is on at aistudio.google.com.");
    if (res.status === 404) throw new Error(`Gemini does not know the model "${model}". Change it in Settings.`);
    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") throw new Error("Gemini quota reached. Wait a minute, or turn on billing for higher limits.");
    throw new Error(`Gemini request failed (${res.status}). ${msg.slice(0, 200)}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) {
    const why = data.promptFeedback?.blockReason;
    throw new Error(why ? `Gemini declined this request (${why}). Try a different photo.` : "Gemini returned nothing. Try again.");
  }
  return cand;
}

export const toGeminiParts = (content: Content[]) =>
  content.map((c) => (c.type === "text" ? { text: c.text } : { inlineData: { mimeType: c.mime, data: c.data } }));

async function askGemini(s: Settings, system: string, content: Content[], opts: AskOptions): Promise<string> {
  if (!s.geminiKey) throw new NoKeyError("gemini");
  const cand = await geminiCall(s.geminiKey, s.geminiModel, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: toGeminiParts(content) }],
    generationConfig: {
      // Gemini 3 models think before answering and the thinking counts
      // against this limit, so leave generous room.
      maxOutputTokens: Math.max(4096, (opts.maxTokens ?? 800) * 4),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    },
  });
  const text = (cand.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
  if (!text) {
    if (cand.finishReason === "MAX_TOKENS") throw new Error("Gemini ran out of room before answering. Try again.");
    if (cand.finishReason === "SAFETY") throw new Error("Gemini declined to answer for safety reasons. Try a different photo.");
    throw new Error("Gemini returned an empty answer. Try again.");
  }
  return text;
}

export function parseJson<T>(text: string): T {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("The stylist sent back something unreadable. Try again.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function imagePart(blob: Blob, max = 768): Promise<Content> {
  const small = await downscale(blob, max);
  return { type: "image", mime: small.type || "image/jpeg", data: await blobToBase64(small) };
}

const compact = (i: WardrobeItem) =>
  `${i.id}: ${i.name} (${i.category}${i.kind ? `/${i.kind}` : ""}, ${i.colors.join("+") || "colour unknown"}, formality ${i.formality}${i.lastWornAt ? `, worn ${i.lastWornAt.slice(0, 10)}` : ""})`;

const STYLIST = `You are a sharp, kind personal stylist for one person. You know exactly what is in their wardrobe. You are honest: if they do not need something, say so. Plain words, no hype, no emoji. Never claim anything about fit or size; fit is decided in the trial room.`;

// ---------- tag a photo of your own clothes ----------

export interface Tags {
  name: string;
  category: Category;
  kind?: string;
  colors: string[];
  pattern?: string;
  formality: number;
}

export async function tagPhoto(photo: Blob): Promise<Tags> {
  const text = await askAI(
    `You catalogue clothing photos. Reply with JSON only.`,
    [
      await imagePart(photo),
      {
        type: "text",
        text: `Describe the single main clothing item in this photo as JSON:
{"name": short shopper style name like "Navy oxford shirt", "category": one of ${CATEGORIES.join("|")}, "kind": e.g. shirt, t-shirt, jeans, chinos, kurta, sneakers, "colors": up to 2 of black|white|grey|navy|blue|denim|beige|cream|brown|olive|green|maroon|red|pink|purple|yellow|orange, "pattern": solid|striped|checked|printed|embroidered|other, "formality": 1 lounge to 5 formal}`,
      },
    ],
    { maxTokens: 300, json: true },
  );
  const t = parseJson<Tags>(text);
  if (!CATEGORIES.includes(t.category)) t.category = "other";
  t.formality = Math.max(1, Math.min(5, Math.round(Number(t.formality) || 3)));
  t.colors = Array.isArray(t.colors) ? t.colors.slice(0, 2) : [];
  return t;
}

// ---------- the take on a product page ----------

export async function productTake(check: ProductCheck, wardrobe: WardrobeItem[], productImage?: Blob): Promise<string> {
  const p: ClassifiedProduct = check.product;
  const content: Content[] = [];
  if (productImage) content.push(await imagePart(productImage));
  content.push({
    type: "text",
    text: `I am looking at: ${p.name}${p.brand ? ` by ${p.brand}` : ""}${p.price ? `, ${p.currency ?? ""} ${p.price}` : ""}.
Our quick read: category ${p.category}, colours ${p.colors.join(", ") || "unknown"}.
Possible duplicates I own: ${check.duplicates.map((d) => d.item.name).join("; ") || "none"}.
My wardrobe:
${wardrobe.slice(0, 120).map(compact).join("\n") || "(empty)"}

In at most 3 short sentences: should I buy it, what exactly would I wear it with from my wardrobe (use item names), and is anything about it redundant. Start with a clear verdict word: Buy, Maybe, or Skip.`,
  });
  return (await askAI(STYLIST, content, { maxTokens: 250 })).trim();
}

// ---------- outfits for an occasion ----------

export async function planOutfits(occasion: string, wardrobe: WardrobeItem[], extra = ""): Promise<Outfit[]> {
  const text = await askAI(
    STYLIST + " Reply with JSON only.",
    [
      {
        type: "text",
        text: `Occasion: ${occasion}. ${extra}
Today is ${new Date().toDateString()}. Prefer things I have not worn in the last few days.
My wardrobe (id: description):
${wardrobe.map(compact).join("\n")}

Return 3 different outfits as JSON array: [{"title": 2 to 5 words, "itemIds": [ids from the list, a top and bottom or a one-piece, plus shoes or a layer if they help], "why": one sentence}]. Only use ids from the list.`,
      },
    ],
    { maxTokens: 700, json: true },
  );
  const ids = new Set(wardrobe.map((i) => i.id));
  return parseJson<Outfit[]>(text)
    .map((o) => ({ ...o, itemIds: (o.itemIds ?? []).filter((id) => ids.has(id)) }))
    .filter((o) => o.itemIds.length > 0)
    .slice(0, 3);
}

// ---------- what is missing ----------

export async function wardrobeGaps(wardrobe: WardrobeItem[]): Promise<string> {
  return (
    await askAI(STYLIST, [
      {
        type: "text",
        text: `My wardrobe:\n${wardrobe.map(compact).join("\n")}\n\nName the 3 additions that would unlock the most new outfits with what I already own. One line each, specific (colour and type), with how many new outfits each would roughly unlock.`,
      },
    ], { maxTokens: 300 })
  ).trim();
}
