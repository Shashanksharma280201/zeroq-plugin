import { clearFaces, type Face } from "@zq/core";
import type { FacesReply, FacesRequest } from "../faces-worker.ts";

/**
 * Reads the faces in a photo, on this device. The work happens in a worker
 * (faces.js) so the page stays smooth while photos are checked.
 *
 * Nothing about a face is saved: the readings live in memory while photos are
 * being added, and are gone when the page closes.
 */
export interface PhotoRead {
  /** clear faces, largest first */
  faces: Face[];
  w: number;
  h: number;
}

const TIMEOUT = 120_000;
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (r: FacesReply | null) => void>();

function give(id: number, r: FacesReply | null) {
  waiting.get(id)?.(r);
  waiting.delete(id);
}

function ask(msg: FacesRequest extends infer T ? (T extends any ? Omit<T, "id"> : never) : never): Promise<FacesReply | null> {
  if (broken) return Promise.resolve(null);
  try {
    if (!worker) {
      worker = new Worker("faces.js");
      worker.onmessage = (e: MessageEvent<FacesReply>) => give(e.data.id, e.data);
      worker.onerror = () => {
        broken = true;
        for (const id of [...waiting.keys()]) give(id, null);
      };
    }
    const id = ++seq;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      setTimeout(() => give(id, null), TIMEOUT);
      worker!.postMessage({ ...msg, id });
    });
  } catch {
    broken = true;
    return Promise.resolve(null);
  }
}

/** Loads the models ahead of the first photo. Resolves false when faces cannot be read in this browser. */
export async function warmFaces(): Promise<boolean> {
  const r = await ask({ warm: true });
  if (!r?.ok) broken = true;
  return !!r?.ok;
}

/** The faces in a photo, or null when the photo (or this browser) cannot be read. */
export async function readFaces(blob: Blob): Promise<PhotoRead | null> {
  const r = await ask({ blob });
  if (!r?.ok) return null;
  return { faces: clearFaces(r.faces), w: r.w, h: r.h };
}

/** Lets go of the models and their memory once photos are done with. */
export function stopFaces() {
  worker?.terminate();
  worker = null;
  for (const id of [...waiting.keys()]) give(id, null);
}
