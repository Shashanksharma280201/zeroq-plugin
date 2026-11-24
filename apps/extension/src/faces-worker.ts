/**
 * Finds faces in a photo and measures each one, on this device.
 *
 * Runs in a worker so the page stays smooth. Nothing here touches the network:
 * the models ship inside the extension, and photos never leave the browser for
 * this step. The measurements (128 numbers per face) only say how alike two
 * faces are. They are kept in memory while photos are being added and are
 * never saved.
 */
import * as faceapi from "@vladmandic/face-api";

export interface WorkerFace {
  /** face box as fractions of the photo: left, top, right, bottom */
  box: [number, number, number, number];
  score: number;
  d: Float32Array;
}
export type FacesRequest = { id: number; blob: Blob } | { id: number; warm: true };
export type FacesReply = { id: number; ok: true; faces: WorkerFace[]; w: number; h: number; ms: number; backend: string } | { id: number; ok: false; error: string };

const MAX_SIDE = 1600;
/** Photos wider than this get a second, closer look in tiles, so small faces at the back of a group are found. */
const TILE_FROM = 900;
const MIN_SCORE = 0.35;

const tf = faceapi.tf as any;
let ready: Promise<string> | null = null;

/** A real graphics chip is fastest. Without one, WebAssembly is far quicker than drawing in software. */
function hasGraphicsChip(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2") ?? new OffscreenCanvas(1, 1).getContext("webgl");
    if (!gl) return false;
    const info = (gl as any).getExtension("WEBGL_debug_renderer_info");
    const name = String(info ? (gl as any).getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
    return !/swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

/** Why a faster way to run the models was passed over. Shown only when someone asks for help. */
const tried: string[] = [];

async function pickBackend(): Promise<string> {
  tf.setWasmPaths("/wasm/");
  // One thread: the threaded build starts helper workers from blob addresses, which extension pages do not allow.
  tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
  for (const name of hasGraphicsChip() ? ["webgl", "wasm", "cpu"] : ["wasm", "webgl", "cpu"]) {
    try {
      if (await tf.setBackend(name)) {
        await tf.ready();
        return name;
      }
      tried.push(`${name}: not available`);
    } catch (e: any) {
      tried.push(`${name}: ${e?.message ?? e}`);
    }
  }
  throw new Error("No way to run the face models in this browser");
}

function start(): Promise<string> {
  ready ??= (async () => {
    const no = () => { throw new Error("not available in a worker"); };
    // The library expects a page. Give it the worker's own canvas and fetch.
    faceapi.env.setEnv({
      Canvas: OffscreenCanvas as any,
      CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D as any,
      Image: class {} as any,
      ImageData: ImageData as any,
      Video: class {} as any,
      createCanvasElement: () => new OffscreenCanvas(1, 1) as any,
      createImageElement: no,
      createVideoElement: no,
      fetch: (url: any, init?: any) => fetch(url, init),
      readFile: no,
    } as any);
    const backend = await pickBackend();
    // A path from the extension's root. (The library mangles full chrome-extension:// addresses.)
    const base = "/models";
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
    ]);
    return backend;
  })();
  return ready;
}

interface Found { x: number; y: number; w: number; h: number; score: number; d: Float32Array }

async function detect(canvas: OffscreenCanvas, sx: number, sy: number, sw: number, sh: number): Promise<Found[]> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const input = tf.browser.fromPixels(ctx.getImageData(sx, sy, sw, sh));
  try {
    const res = await faceapi
      .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_SCORE, maxResults: 30 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    return res.map((r) => {
      const b = r.detection.box;
      return { x: sx + b.x, y: sy + b.y, w: b.width, h: b.height, score: r.detection.score, d: r.descriptor };
    });
  } finally {
    input.dispose();
  }
}

function overlap(a: Found, b: Found): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

async function read(blob: Blob): Promise<{ faces: WorkerFace[]; w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const full = { w: bmp.width, h: bmp.height };
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  let found = await detect(canvas, 0, 0, w, h);
  // The first pass sees the photo shrunk to about 512 pixels. When the biggest face is small in it
  // (a full-length group shot), the people beside or behind may be too small to see: look closer.
  const seen = 512 / Math.max(w, h);
  const biggest = Math.max(0, ...found.map((f) => f.h)) * seen;
  if (Math.max(w, h) > TILE_FROM && biggest < 60) {
    // Four overlapping quarters. A face cut by a tile edge is found whole in the neighbour or in the full pass.
    const tw = Math.round(w * 0.6), th = Math.round(h * 0.6);
    for (const [tx, ty] of [[0, 0], [w - tw, 0], [0, h - th], [w - tw, h - th]]) {
      const edge = 3;
      const more = (await detect(canvas, tx, ty, tw, th)).filter((f) => {
        // drop faces touching an inner tile edge: they may be half a face
        const cutL = tx > 0 && f.x - tx < edge, cutT = ty > 0 && f.y - ty < edge;
        const cutR = tx + tw < w && tx + tw - (f.x + f.w) < edge, cutB = ty + th < h && ty + th - (f.y + f.h) < edge;
        return !(cutL || cutT || cutR || cutB);
      });
      found.push(...more);
    }
  }
  // The same face can turn up in several passes: keep the most certain copy.
  const kept: Found[] = [];
  for (const f of found.sort((a, b) => b.score - a.score)) if (!kept.some((k) => overlap(k, f) > 0.45)) kept.push(f);
  kept.sort((a, b) => b.w * b.h - a.w * a.h);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return {
    w: full.w, h: full.h,
    faces: kept.slice(0, 30).map((f) => ({ box: [clamp(f.x / w), clamp(f.y / h), clamp((f.x + f.w) / w), clamp((f.y + f.h) / h)], score: f.score, d: f.d })),
  };
}

let chain: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent<FacesRequest>) => {
  const msg = e.data;
  chain = chain.then(async () => {
    const t0 = performance.now();
    try {
      const backend = await start();
      if ("warm" in msg) return (self as any).postMessage({ id: msg.id, ok: true, faces: [], w: 0, h: 0, ms: performance.now() - t0, backend, tried } as FacesReply);
      const r = await read(msg.blob);
      (self as any).postMessage({ id: msg.id, ok: true, ...r, ms: performance.now() - t0, backend } satisfies FacesReply);
    } catch (err: any) {
      (self as any).postMessage({ id: msg.id, ok: false, error: err?.message ?? String(err) } satisfies FacesReply);
    }
  });
};
