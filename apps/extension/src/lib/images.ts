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
