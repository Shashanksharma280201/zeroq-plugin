/**
 * Image helpers that work in pages and in the service worker
 * (no FileReader, no DOM canvas).
 */

const MAX_SIDE = 1024;

/** Fetch a data: or http(s) URL and return a downscaled JPEG blob. */
export async function srcToBlob(src: string, maxSide = MAX_SIDE): Promise<Blob> {
  const res = await fetch(src, { credentials: "omit" });
  if (!res.ok) throw new Error(`Could not load the image (${res.status})`);
  return downscale(await res.blob(), maxSide);
}

export async function downscale(blob: Blob, maxSide = MAX_SIDE): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && blob.type === "image/jpeg") return blob;
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  } catch {
    return blob; // formats createImageBitmap cannot read (e.g. some AVIF) pass through
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type || "image/jpeg"};base64,${await blobToBase64(blob)}`;
}

/** SHA-256 of a blob's bytes, as hex. Same photo, same hash, on every device. */
export async function hashBlob(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Crops a photo to a box (fractions 0..1) with a little room around it. */
export async function cropTo(blob: Blob, box: [number, number, number, number], pad = 0.06): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  const L = Math.max(0, x0 - w * pad), T = Math.max(0, y0 - h * pad * 0.6);
  const R = Math.min(1, x1 + w * pad), B = Math.min(1, y1 + h * pad * 0.6);
  const sx = Math.round(L * bmp.width), sy = Math.round(T * bmp.height);
  const sw = Math.max(1, Math.round((R - L) * bmp.width)), sh = Math.max(1, Math.round((B - T) * bmp.height));
  const c = new OffscreenCanvas(sw, sh);
  c.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close?.();
  return c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}
