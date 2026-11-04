import { CATEGORIES, type Category, type ClassifiedProduct, type Outfit, type ProductCheck, type WardrobeItem } from "@zq/core";
import { blobToBase64, downscale } from "./images.ts";
import { getSettings } from "./settings.ts";

/**
 * Claude, called straight from the extension with your own key.
 * Every function here has an offline fallback in @zq/core, so the
 * extension still works with no key at all.
 */

export class NoKeyError extends Error {
  constructor() {
    super("Add your Anthropic API key in Settings to use the stylist.");
  }
}

export type Content =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export async function askClaude(system: string, content: Content[], maxTokens = 800): Promise<string> {
  const s = await getSettings();
  if (!s.anthropicKey) throw new NoKeyError();
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
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("Anthropic rejected the API key. Check it in Settings.");
    throw new Error(`Stylist request failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

export function parseJson<T>(text: string): T {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("The stylist sent back something unreadable. Try again.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function imagePart(blob: Blob, max = 768): Promise<Content> {
  const small = await downscale(blob, max);
  return { type: "image", source: { type: "base64", media_type: small.type || "image/jpeg", data: await blobToBase64(small) } };
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
  const text = await askClaude(
    `You catalogue clothing photos. Reply with JSON only.`,
    [
      await imagePart(photo),
      {
        type: "text",
        text: `Describe the single main clothing item in this photo as JSON:
{"name": short shopper style name like "Navy oxford shirt", "category": one of ${CATEGORIES.join("|")}, "kind": e.g. shirt, t-shirt, jeans, chinos, kurta, sneakers, "colors": up to 2 of black|white|grey|navy|blue|denim|beige|cream|brown|olive|green|maroon|red|pink|purple|yellow|orange, "pattern": solid|striped|checked|printed|embroidered|other, "formality": 1 lounge to 5 formal}`,
      },
    ],
    300,
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
  return (await askClaude(STYLIST, content, 250)).trim();
}

// ---------- outfits for an occasion ----------

export async function planOutfits(occasion: string, wardrobe: WardrobeItem[], extra = ""): Promise<Outfit[]> {
  const text = await askClaude(
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
    700,
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
    await askClaude(STYLIST, [
      {
        type: "text",
        text: `My wardrobe:\n${wardrobe.map(compact).join("\n")}\n\nName the 3 additions that would unlock the most new outfits with what I already own. One line each, specific (colour and type), with how many new outfits each would roughly unlock.`,
      },
    ], 300)
  ).trim();
}
