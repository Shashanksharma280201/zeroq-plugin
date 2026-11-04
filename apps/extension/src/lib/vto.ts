import type { Category } from "@zq/core";
import { geminiCall } from "./ai.ts";
import { blobToBase64, blobToDataUrl, downscale } from "./images.ts";
import { getSettings } from "./settings.ts";

/**
 * Virtual try-on with your own key, through either
 *  - Gemini image editing (Nano Banana, default): one call, returns an image, or
 *  - FASHN (https://docs.fashn.ai): purpose-built try-on; submit to /v1/run, poll /v1/status/{id}.
 * Shows colour and silhouette. It says nothing about fit.
 */

const API = "https://api.fashn.ai/v1";

export function vtoCategory(c: Category): "tops" | "bottoms" | "one-pieces" | "auto" {
  if (c === "top" || c === "outerwear") return "tops";
  if (c === "bottom") return "bottoms";
  if (c === "one-piece") return "one-pieces";
  return "auto";
}

export const canTryOn = (c: Category) => c === "top" || c === "bottom" || c === "one-piece" || c === "outerwear";

interface TryOnOpts {
  person: Blob;
  garment: Blob;
  category: Category;
  signal?: AbortSignal;
  onStatus?: (s: string) => void;
}

/** Returns an image URL (https: for FASHN, data: for Gemini). */
export async function tryOn(opts: TryOnOpts): Promise<string> {
  const s = await getSettings();
  return s.tryOnProvider === "fashn" ? fashnTryOn(opts) : geminiTryOn(opts);
}

const PART: Record<string, string> = {
  top: "top (shirt, t-shirt, kurta or similar)",
  outerwear: "outer layer (jacket, overshirt or similar), worn over what they have on",
  bottom: "bottoms (trousers, jeans, skirt or similar)",
  "one-piece": "whole outfit (dress, jumpsuit or similar), replacing both top and bottom",
};

async function geminiTryOn(opts: TryOnOpts): Promise<string> {
  const { geminiKey, geminiImageModel } = await getSettings();
  if (!geminiKey) throw new Error("Add your Gemini API key in Settings to use try-on.");
  opts.onStatus?.("Dressing you");
  const [person, garment] = await Promise.all([downscale(opts.person, 1024), downscale(opts.garment, 1024)]);
  if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const cand = await geminiCall(geminiKey, geminiImageModel, {
    contents: [{
      role: "user",
      parts: [
        { text: "Image 1 is a photo of me." },
        { inlineData: { mimeType: person.type || "image/jpeg", data: await blobToBase64(person) } },
        { text: "Image 2 is a clothing item from a shop." },
        { inlineData: { mimeType: garment.type || "image/jpeg", data: await blobToBase64(garment) } },
        {
          text: `Edit image 1 so I am wearing the item from image 2 as my ${PART[opts.category] ?? "clothing"}.
Keep my face, hair, skin tone, body shape, pose, background and lighting exactly as they are. Change only that piece of clothing.
Reproduce the item's colour, pattern, fabric texture and details faithfully, draped naturally on my body. If image 2 shows a model, take only the garment, never the model.
Photorealistic. Return only the edited photo.`,
        },
      ],
    }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  const img = (cand.content?.parts ?? []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
  const d = img?.inlineData ?? img?.inline_data;
  if (!d) {
    const said = (cand.content?.parts ?? []).map((p: any) => p.text).filter(Boolean).join(" ");
    throw new Error(said ? `Gemini did not return a photo: ${said.slice(0, 160)}` : "Gemini did not return a photo. Try a clearer photo of the item.");
  }
  return `data:${d.mimeType ?? d.mime_type ?? "image/png"};base64,${d.data}`;
}

async function fashnTryOn(opts: TryOnOpts): Promise<string> {
  const { fashnKey } = await getSettings();
  if (!fashnKey) throw new Error("Add your FASHN API key in Settings to use try-on.");
  const headers = { "content-type": "application/json", authorization: `Bearer ${fashnKey}` };

  opts.onStatus?.("Uploading");
  const res = await fetch(`${API}/run`, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      model_name: "tryon-v1.6",
      inputs: {
        model_image: await blobToDataUrl(await downscale(opts.person, 1024)),
        garment_image: await blobToDataUrl(await downscale(opts.garment, 1024)),
        category: vtoCategory(opts.category),
        mode: "balanced",
      },
    }),
  });
  if (res.status === 401) throw new Error("FASHN rejected the API key. Check it in Settings.");
  if (!res.ok) throw new Error(`Try-on could not start (${res.status}).`);
  const { id, error } = await res.json();
  if (error || !id) throw new Error(error?.message ?? "Try-on could not start.");

  const started = Date.now();
  while (Date.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, 1800));
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const s = await fetch(`${API}/status/${id}`, { headers, signal: opts.signal }).then((r) => r.json());
    if (s.status === "completed" && s.output?.[0]) return s.output[0] as string;
    if (s.status === "failed") {
      const name = s.error?.name ?? "";
      if (/Pose/i.test(name)) throw new Error("Could not find a clear body pose. Use a front facing, well lit photo of yourself.");
      throw new Error(s.error?.message ?? "Try-on failed. A different photo of the item usually helps.");
    }
    opts.onStatus?.(s.status === "processing" ? "Dressing you" : "In the queue");
  }
  throw new Error("Try-on took too long. Try again in a minute.");
}
