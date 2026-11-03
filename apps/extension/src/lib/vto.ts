import type { Category } from "@zq/core";
import { blobToDataUrl, downscale } from "./images.ts";
import { getSettings } from "./settings.ts";

/**
 * Virtual try-on through FASHN (https://docs.fashn.ai), with your own key.
 * Submit to /v1/run, then poll /v1/status/{id}.
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

export async function tryOn(opts: {
  person: Blob;
  garment: Blob;
  category: Category;
  signal?: AbortSignal;
  onStatus?: (s: string) => void;
}): Promise<string> {
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
