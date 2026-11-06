import { buildMemory, type EventType, type TasteMemory, type ZQEvent } from "@zq/core";
import { blobHashFor, claimMeta, getBlob, getMeta, listItems, open, setMeta, tx } from "./db.ts";

/**
 * The event log. Every action Zero Q sees is written here once and never
 * edited. A copy goes to the outbox for Google Drive sync. The taste memory
 * is rebuilt from this log every 20 events and once a day.
 */

const REBUILD_EVERY = 20;

// ---------- ids ----------

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastMs = 0;
let lastRand: number[] = [];
/** ULID: 10 chars of time, 16 of randomness, sortable as text. Monotonic within one ms. */
export function ulid(now = Date.now()): string {
  let t = "";
  let ms = now;
  for (let i = 0; i < 10; i++) {
    t = B32[ms % 32] + t;
    ms = Math.floor(ms / 32);
  }
  let r: number[];
  if (now === lastMs && lastRand.length) {
    r = [...lastRand];
    for (let i = 15; i >= 0; i--) {
      if (r[i] < 31) {
        r[i]++;
        break;
      }
      r[i] = 0;
    }
  } else {
    r = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b % 32);
  }
  lastMs = now;
  lastRand = r;
  return t + r.map((x) => B32[x]).join("");
}

/** Short stable key for an item, from its page URL without the query string. */
export function itemKeyOf(url: string, src?: string): string {
  let base = url;
  try {
    const u = new URL(url);
    base = u.origin + u.pathname;
  } catch {}
  const s = src ? `${base}#${src.split("?")[0]}` : base;
  // FNV-1a, 52 bits, as base 36
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xfffffffffffffn;
  }
  return h.toString(36);
}

let devicep: Promise<string> | null = null;
export function deviceId(): Promise<string> {
  devicep ??= chrome.storage.local.get("deviceId").then(async (s) => {
    if (s.deviceId) return s.deviceId as string;
    const id = ulid().slice(10, 18).toLowerCase();
    await chrome.storage.local.set({ deviceId: id });
    return id;
  });
  return devicep;
}

// ---------- writing ----------

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("zeroq-events") : null;

export async function logEvent<P = any>(type: EventType, payload: P, refs?: ZQEvent["refs"]): Promise<ZQEvent<P>> {
  const e: ZQEvent<P> = { id: ulid(), ts: new Date().toISOString(), type, payload: strip(payload), refs, v: 1, device: await deviceId() };
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(["events", "outbox"], "readwrite");
    t.objectStore("events").put(e);
    t.objectStore("outbox").put({ id: e.id });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  channel?.postMessage({ kind: "event", type });
  const n = ((await getMeta<number>("sinceBuild")) ?? 0) + 1;
  await setMeta("sinceBuild", n);
  if (n >= REBUILD_EVERY) rebuildMemory().catch(() => {});
  return e;
}

/** Drops undefined values and data: URLs so events stay small and JSON-safe. */
function strip<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === "string" && x.startsWith("data:") ? undefined : x)));
}

/**
 * Inserts events from a backup or another browser. Existing ids are skipped,
 * so running it twice changes nothing. Returns the events that were new.
 */
export async function putEvents(events: ZQEvent[], opts: { outbox?: boolean } = {}): Promise<ZQEvent[]> {
  const db = await open();
  const fresh: ZQEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(["events", "outbox"], "readwrite");
    const st = t.objectStore("events");
    for (const e of events) {
      if (!e?.id || !e.type) continue;
      const g = st.getKey(e.id);
      g.onsuccess = () => {
        if (g.result != null) return;
        st.put(e);
        if (opts.outbox) t.objectStore("outbox").put({ id: e.id });
        fresh.push(e);
      };
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  if (fresh.length) channel?.postMessage({ kind: "event", type: "sync" });
  return fresh.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- reading ----------

export async function listEvents(): Promise<ZQEvent[]> {
  const all = await tx<ZQEvent[]>("events", "readonly", (s) => s.getAll());
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getEvents(ids: string[]): Promise<ZQEvent[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction("events", "readonly");
    const out: ZQEvent[] = [];
    for (const id of ids) {
      const g = t.objectStore("events").get(id);
      g.onsuccess = () => g.result && out.push(g.result);
    }
    t.oncomplete = () => resolve(out.sort((a, b) => a.id.localeCompare(b.id)));
    t.onerror = () => reject(t.error);
  });
}

export function countEvents(): Promise<number> {
  return tx<number>("events", "readonly", (s) => s.count());
}

export function onEvents(fn: (m: { kind: string; type?: string }) => void): () => void {
  if (!channel) return () => {};
  const ch = new BroadcastChannel("zeroq-events");
  ch.onmessage = (e) => fn(e.data);
  return () => ch.close();
}

// ---------- memory ----------

export async function getMemory(): Promise<TasteMemory | null> {
  return (await tx<TasteMemory | undefined>("memory", "readonly", (s) => s.get("current"))) ?? null;
}

export async function saveMemory(m: TasteMemory): Promise<void> {
  await tx("memory", "readwrite", (s) => s.put(m, "current"));
  channel?.postMessage({ kind: "memory" });
}

let building: Promise<TasteMemory> | null = null;
export function rebuildMemory(): Promise<TasteMemory> {
  building ??= (async () => {
    try {
      const [events, prev] = await Promise.all([listEvents(), getMemory()]);
      const m = buildMemory(events, prev);
      await saveMemory(m);
      await setMeta("sinceBuild", 0);
      return m;
    } finally {
      building = null;
    }
  })();
  return building;
}

/** Wipes the log, the outbox and the memory. Wardrobe and profile stay. */
export async function clearHistory(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(["events", "outbox", "memory"], "readwrite");
    for (const s of ["events", "outbox", "memory"]) t.objectStore(s).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  await setMeta("sinceBuild", 0);
  channel?.postMessage({ kind: "memory" });
}

// ---------- first run on v2 ----------

/**
 * Writes what you already had (wardrobe, profile, try-on photo) into the log
 * once, so memory and sync start complete. Safe to call from several places.
 */
export async function backfill(): Promise<void> {
  if (!(await claimMeta("backfilled"))) return;
  for (const item of (await listItems()).reverse()) {
    await logEvent("wardrobe_added", { item, blobHash: item.image ? await blobHashFor(item.image) : undefined }, { items: [item.id] });
  }
  const profile = (await chrome.storage.local.get("profile")).profile;
  if (profile) await logEvent("profile_built", { profile, photos: await outfitPhotoHashes() });
  if (await getBlob("me:photo")) await logEvent("photo_set", { key: "me:photo", hash: await blobHashFor("me:photo") });
  await rebuildMemory();
}

export async function outfitPhotoHashes(): Promise<Array<{ key: string; hash: string }>> {
  const out: Array<{ key: string; hash: string }> = [];
  for (let i = 0; i < 8; i++) {
    const h = await blobHashFor(`outfit:${i}`);
    if (h) out.push({ key: `outfit:${i}`, hash: h });
  }
  return out;
}
