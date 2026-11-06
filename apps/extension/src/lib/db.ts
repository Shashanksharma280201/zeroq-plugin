import type { NewWardrobeItem, WardrobeItem } from "@zq/core";
import { logEvent, putEvents } from "./events.ts";
import { blobToDataUrl, hashBlob, srcToBlob } from "./images.ts";

/**
 * Everything lives in this browser profile, in IndexedDB under the
 * extension's origin. The side panel, the full page and the background
 * worker all share it. Nothing is sent anywhere except to the AI and
 * try-on providers you configure.
 */
const DB_NAME = "zeroq";
const VERSION = 2;

let dbp: Promise<IDBDatabase> | null = null;
export function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      // v2: memory. An append-only event log, an outbox for sync, the
      // derived taste memory, and small bookkeeping values.
      if (!db.objectStoreNames.contains("events")) {
        const ev = db.createObjectStore("events", { keyPath: "id" });
        ev.createIndex("type", "type");
        ev.createIndex("ts", "ts");
      }
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("memory")) db.createObjectStore("memory");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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
  await logEvent("wardrobe_added", { item, blobHash: image ? await blobHashFor(image) : undefined }, { items: [id] });
  return item;
}

export async function updateItem(id: string, patch: Partial<WardrobeItem>): Promise<void> {
  const cur = await tx<WardrobeItem | undefined>("items", "readonly", (s) => s.get(id));
  if (!cur) return;
  const next = { ...cur, ...patch, id };
  await tx("items", "readwrite", (s) => s.put(next));
  notify();
  await logEvent("wardrobe_updated", { item: next }, { items: [id] });
}

export async function deleteItem(id: string): Promise<void> {
  const cur = await tx<WardrobeItem | undefined>("items", "readonly", (s) => s.get(id));
  await tx("items", "readwrite", (s) => s.delete(id));
  if (cur?.image) await tx("blobs", "readwrite", (s) => s.delete(cur.image!));
  notify();
  await logEvent("wardrobe_removed", { id, name: cur?.name }, { items: [id] });
}

export async function markWorn(ids: string[], occasion?: string): Promise<void> {
  await applyWorn(ids, new Date().toISOString());
  const items = (await listItems()).filter((x) => ids.includes(x.id));
  const f = items.length ? Math.round(items.reduce((s, i) => s + (i.formality || 3), 0) / items.length) : undefined;
  await logEvent("outfit_worn", { itemIds: ids, occasion, formality: f }, { items: ids });
}

/** Marks pieces worn without logging; used for your own taps and for events synced from another browser. */
export async function applyWorn(ids: string[], at: string): Promise<void> {
  const items = await listItems();
  for (const i of items.filter((x) => ids.includes(x.id))) {
    await tx("items", "readwrite", (s) => s.put({ ...i, lastWornAt: at, wornCount: i.wornCount + 1 }));
  }
  notify();
}

/** Writes an item exactly as given, no event. For sync. */
export async function putItemRaw(item: WardrobeItem): Promise<void> {
  await tx("items", "readwrite", (s) => s.put(item));
  notify();
}
export async function deleteItemRaw(id: string): Promise<void> {
  await tx("items", "readwrite", (s) => s.delete(id));
  notify();
}

/** Content hash of a stored blob, remembered so photos sync once. */
export async function blobHashFor(key: string): Promise<string | undefined> {
  const b = await getBlob(key);
  if (!b) return undefined;
  const h = await hashBlob(b);
  await setMeta(`hash:${key}`, h);
  return h;
}

// ---------- meta (small values: device id, sync cursors, counters) ----------

export function getMeta<T = any>(key: string): Promise<T | undefined> {
  return tx<T | undefined>("meta", "readonly", (s) => s.get(key));
}
export function setMeta(key: string, value: unknown) {
  return tx("meta", "readwrite", (s) => s.put(value, key));
}
/** Sets a flag only if it was not set; true when this call set it. Atomic across panel and worker. */
export function claimMeta(key: string): Promise<boolean> {
  return open().then(
    (db) =>
      new Promise<boolean>((resolve, reject) => {
        const t = db.transaction("meta", "readwrite");
        const st = t.objectStore("meta");
        let won = false;
        const g = st.get(key);
        g.onsuccess = () => {
          if (g.result == null) {
            st.put(new Date().toISOString(), key);
            won = true;
          }
        };
        t.oncomplete = () => resolve(won);
        t.onerror = () => reject(t.error);
      }),
  );
}

// ---------- blobs (item photos, your try-on photo) ----------

export function putBlob(key: string, blob: Blob) {
  return tx("blobs", "readwrite", (s) => s.put(blob, key));
}
export async function listBlobKeys(): Promise<string[]> {
  return (await tx<IDBValidKey[]>("blobs", "readonly", (s) => s.getAllKeys())).map(String);
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
  const events = await tx<unknown[]>("events", "readonly", (s) => s.getAll());
  const memory = await tx<unknown>("memory", "readonly", (s) => s.get("current"));
  const profile = (await chrome.storage.local.get("profile")).profile ?? null;
  for (const k of await listBlobKeys()) {
    if (images[k] || !/^(outfit:|me:)/.test(k)) continue;
    const b = await getBlob(k);
    if (b) images[k] = await blobToDataUrl(b);
  }
  return new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items, images, profile, events, memory })], { type: "application/json" });
}

export async function importAll(file: Blob): Promise<number> {
  const data = JSON.parse(await file.text());
  let n = 0;
  for (const item of data.items as WardrobeItem[]) {
    if (item.image && data.images?.[item.image]) await putBlob(item.image, await (await fetch(data.images[item.image])).blob());
    await tx("items", "readwrite", (s) => s.put(item));
    n++;
  }
  for (const [k, v] of Object.entries((data.images ?? {}) as Record<string, string>)) {
    if (/^(outfit:|me:)/.test(k)) await putBlob(k, await (await fetch(v)).blob());
  }
  if (data.profile) await chrome.storage.local.set({ profile: data.profile });
  if (Array.isArray(data.events)) {
    await putEvents(data.events, { outbox: true });
  }
  notify();
  return n;
}
