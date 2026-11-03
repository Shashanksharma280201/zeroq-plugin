import type { NewWardrobeItem, WardrobeItem } from "@zq/core";
import { blobToDataUrl, srcToBlob } from "./images.ts";

/**
 * Everything lives in this browser profile, in IndexedDB under the
 * extension's origin. The side panel, the full page and the background
 * worker all share it. Nothing is sent anywhere except to the AI and
 * try-on providers you configure.
 */
const DB_NAME = "zeroq";
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
      }),
  );
}

const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

// ---------- items ----------

export async function listItems(): Promise<WardrobeItem[]> {
  const items = await tx<WardrobeItem[]>("items", "readonly", (s) => s.getAll());
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addItem(input: NewWardrobeItem): Promise<WardrobeItem> {
  const { imageSrc, ...rest } = input;
  const id = uid();
  let image: string | undefined;
  if (imageSrc) {
    const blob = await srcToBlob(imageSrc);
    image = `item:${id}`;
    await putBlob(image, blob);
  }
  const item: WardrobeItem = { ...rest, id, image, createdAt: new Date().toISOString(), wornCount: 0 };
  await tx("items", "readwrite", (s) => s.put(item));
  notify();
  return item;
}

export async function updateItem(id: string, patch: Partial<WardrobeItem>): Promise<void> {
  const cur = await tx<WardrobeItem | undefined>("items", "readonly", (s) => s.get(id));
  if (!cur) return;
  await tx("items", "readwrite", (s) => s.put({ ...cur, ...patch, id }));
  notify();
}

export async function deleteItem(id: string): Promise<void> {
  const cur = await tx<WardrobeItem | undefined>("items", "readonly", (s) => s.get(id));
  await tx("items", "readwrite", (s) => s.delete(id));
  if (cur?.image) await tx("blobs", "readwrite", (s) => s.delete(cur.image!));
  notify();
}

export async function markWorn(ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  const items = await listItems();
  for (const i of items.filter((x) => ids.includes(x.id))) {
    await tx("items", "readwrite", (s) => s.put({ ...i, lastWornAt: now, wornCount: i.wornCount + 1 }));
  }
  notify();
}

// ---------- blobs (item photos, your try-on photo) ----------

export function putBlob(key: string, blob: Blob) {
  return tx("blobs", "readwrite", (s) => s.put(blob, key));
}
export function getBlob(key: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>("blobs", "readonly", (s) => s.get(key));
}
export function deleteBlob(key: string) {
  return tx("blobs", "readwrite", (s) => s.delete(key));
}

// ---------- change notifications across panel, page and worker ----------

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("zeroq-db") : null;
function notify() {
  channel?.postMessage("changed");
  for (const l of listeners) l();
}
const listeners = new Set<() => void>();
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  const h = () => fn();
  channel?.addEventListener("message", h);
  return () => {
    listeners.delete(fn);
    channel?.removeEventListener("message", h);
  };
}

// ---------- backup ----------

export async function exportAll(): Promise<Blob> {
  const items = await listItems();
  const images: Record<string, string> = {};
  for (const i of items) {
    if (!i.image) continue;
    const b = await getBlob(i.image);
    if (b) images[i.image] = await blobToDataUrl(b);
  }
  return new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items, images })], { type: "application/json" });
}

export async function importAll(file: Blob): Promise<number> {
  const data = JSON.parse(await file.text());
  let n = 0;
  for (const item of data.items as WardrobeItem[]) {
    if (item.image && data.images?.[item.image]) await putBlob(item.image, await srcToBlob(data.images[item.image]));
    await tx("items", "readwrite", (s) => s.put(item));
    n++;
  }
  notify();
  return n;
}
