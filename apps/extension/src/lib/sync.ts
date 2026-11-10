import type { ZQEvent } from "@zq/core";
import { getBlob, getMeta, open, setMeta } from "./db.ts";
import { blobRefs, replay, type BlobRef } from "./replay.ts";
import { deviceId, getEvents, putEvents, rebuildMemory } from "./events.ts";
import { hashBlob } from "./images.ts";
import { googleRedirect } from "./platform.ts";
import { getSettings, type Settings } from "./settings.ts";

/**
 * Google Drive sync.
 *
 * Everything goes to the hidden app-data folder of your own Drive, which only
 * Zero Q can see. The event log is the source of truth: your wardrobe,
 * profile and photos are all rebuilt from events, so another browser that
 * pulls the same events ends up with the same Zero Q.
 *
 *   events-<device>-<first>-<last>.zq   a batch of events, encrypted
 *   blob-<sha256>                        one photo, encrypted, named by its content
 *   zq-keycheck                          the salt and a check value for your passphrase
 *
 * Encryption: PBKDF2 (310,000 rounds, SHA-256) turns your passphrase into an
 * AES-GCM key on this device. Drive only ever stores ciphertext.
 */

const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const ROUNDS = 310_000;
const BATCH = 500;

export interface SyncState {
  lastSync?: string;
  lastError?: string;
  email?: string;
  pushed?: number;
  pulled?: number;
  photos?: number;
}

export async function getSyncState(): Promise<SyncState> {
  return ((await chrome.storage.local.get("syncState")).syncState as SyncState) ?? {};
}
async function setSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await getSyncState()), ...patch };
  await chrome.storage.local.set({ syncState: next });
  return next;
}
export function onSyncState(fn: (s: SyncState) => void): () => void {
  const h = (c: Record<string, chrome.storage.StorageChange>, area: string) => area === "local" && c.syncState && fn(c.syncState.newValue ?? {});
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}

// ---------- sign in ----------

/** The redirect URL to paste into your Google Cloud OAuth client. */
export const redirectUrl = () => googleRedirect();

export class NeedsSignIn extends Error {
  constructor() {
    super("Sign in to Google Drive again in Settings.");
  }
}

async function token(clientId: string, interactive: boolean): Promise<string> {
  const cached = (await chrome.storage.session.get("driveToken")).driveToken as { token: string; exp: number; client: string } | undefined;
  if (cached && cached.client === clientId && cached.exp - 60_000 > Date.now()) return cached.token;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirectUrl());
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("include_granted_scopes", "true");
  if (!interactive) url.searchParams.set("prompt", "none");
  let back: string | undefined;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive });
  } catch (e: any) {
    if (!interactive) throw new NeedsSignIn();
    throw new Error(/did not approve|cancel/i.test(e?.message ?? "") ? "Google sign-in was closed before it finished." : `Google sign-in failed: ${e?.message ?? e}`);
  }
  const params = new URLSearchParams(new URL(back ?? "").hash.slice(1));
  if (params.get("error")) {
    if (!interactive) throw new NeedsSignIn();
    throw new Error(`Google sign-in failed: ${params.get("error")}`);
  }
  const t = params.get("access_token");
  if (!t) throw interactive ? new Error("Google did not return a token.") : new NeedsSignIn();
  const exp = Date.now() + Number(params.get("expires_in") ?? 3600) * 1000;
  await chrome.storage.session.set({ driveToken: { token: t, exp, client: clientId } });
  return t;
}

/** Opens Google sign-in (must run from a click), then checks the passphrase against Drive. */
export async function connectDrive(): Promise<SyncState> {
  const s = await getSettings();
  if (!s.driveClientId) throw new Error("Add your Google OAuth client ID first.");
  if (s.drivePassphrase.length < 8) throw new Error("Choose a passphrase of at least 8 characters.");
  const t = await token(s.driveClientId, true);
  const about = await fetch(`${API}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${t}` } });
  const email = about.ok ? ((await about.json()).user?.emailAddress as string | undefined) : undefined;
  const d = drive(s);
  await cryptoKey(d, s.drivePassphrase);
  return setSyncState({ email, lastError: undefined });
}

export async function disconnectDrive(): Promise<void> {
  const cached = (await chrome.storage.session.get("driveToken")).driveToken as { token: string } | undefined;
  if (cached) fetch(`https://oauth2.googleapis.com/revoke?token=${cached.token}`, { method: "POST" }).catch(() => {});
  await chrome.storage.session.remove("driveToken");
  keyCache = null;
  await setSyncState({ email: undefined });
}

// ---------- Drive REST ----------

interface DFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

function drive(s: Settings) {
  const call = async (url: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const t = await token(s.driveClientId, false);
    const res = await fetch(url, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${t}` } });
    if (res.status === 401 && retry) {
      await chrome.storage.session.remove("driveToken");
      return call(url, init, false);
    }
    if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res;
  };
  return {
    async list(q: string): Promise<DFile[]> {
      const out: DFile[] = [];
      let page: string | undefined;
      do {
        const u = new URL(`${API}/files`);
        u.searchParams.set("spaces", "appDataFolder");
        u.searchParams.set("q", q);
        u.searchParams.set("pageSize", "1000");
        u.searchParams.set("fields", "nextPageToken,files(id,name,appProperties)");
        if (page) u.searchParams.set("pageToken", page);
        const j = await (await call(u.toString())).json();
        out.push(...(j.files ?? []));
        page = j.nextPageToken;
      } while (page);
      return out;
    },
    async upload(name: string, body: BufferSource, appProperties: Record<string, string> = {}): Promise<DFile> {
      const boundary = `zq${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name, parents: ["appDataFolder"], appProperties });
      const blob = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
        body,
        `\r\n--${boundary}--`,
      ]);
      const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,appProperties`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: blob,
      });
      return res.json();
    },
    async download(id: string): Promise<ArrayBuffer> {
      return (await call(`${API}/files/${id}?alt=media`)).arrayBuffer();
    },
    async remove(id: string): Promise<void> {
      await call(`${API}/files/${id}`, { method: "DELETE" });
    },
  };
}
type Drive = ReturnType<typeof drive>;

// ---------- encryption ----------

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const CHECK = "zeroq-ok";

let keyCache: { pass: string; key: CryptoKey } | null = null;

async function derive(pass: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ROUNDS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(key: CryptoKey, data: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decrypt(key: CryptoKey, data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
}

/** The key for this Drive: made on first use, then checked against the stored check value. */
async function cryptoKey(d: Drive, pass: string): Promise<CryptoKey> {
  if (keyCache?.pass === pass) return keyCache.key;
  const [found] = await d.list("name = 'zq-keycheck'");
  let key: CryptoKey;
  if (!found) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pass, salt);
    const check = await encrypt(key, new TextEncoder().encode(CHECK));
    await d.upload("zq-keycheck", new Uint8Array(0), { salt: b64(salt), check: b64(check) });
  } else {
    const p = found.appProperties ?? {};
    key = await derive(pass, unb64(p.salt ?? ""));
    try {
      const plain = new TextDecoder().decode(await decrypt(key, unb64(p.check ?? "")));
      if (plain !== CHECK) throw new Error();
    } catch {
      throw new Error("That passphrase does not match the one this Google Drive was set up with.");
    }
  }
  keyCache = { pass, key };
  return key;
}

// ---------- sync ----------

let running: Promise<SyncState> | null = null;

/** Push the outbox, pull what other browsers wrote, rebuild memory. Safe to call often. */
export function syncNow(): Promise<SyncState> {
  running ??= run().finally(() => (running = null));
  return running;
}

async function run(): Promise<SyncState> {
  const s = await getSettings();
  if (!s.driveSync || !s.driveClientId || !s.drivePassphrase) return getSyncState();
  try {
    const d = drive(s);
    const key = await cryptoKey(d, s.drivePassphrase);
    const files = await d.list("trashed = false");
    const blobs = new Set(files.filter((f) => f.name.startsWith("blob-")).map((f) => f.name.slice(5)));
    const blobFile = new Map(files.filter((f) => f.name.startsWith("blob-")).map((f) => [f.name.slice(5), f]));
    const seen = new Set((await getMeta<string[]>("seenFiles")) ?? []);

    // ---- push ----
    let pushed = 0;
    let photos = 0;
    const me = await deviceId();
    for (;;) {
      const ids = (await outboxIds()).slice(0, BATCH);
      if (!ids.length) break;
      const events = await getEvents(ids);
      for (const ref of events.flatMap(blobRefs)) {
        if (blobs.has(ref.hash)) continue;
        const b = await getBlob(ref.key);
        if (!b || (await hashBlob(b)) !== ref.hash) continue; // the photo changed since; a later event carries it
        await d.upload(`blob-${ref.hash}`, await encrypt(key, await b.arrayBuffer()), { type: b.type || "image/jpeg" });
        blobs.add(ref.hash);
        photos++;
      }
      if (events.length) {
        const name = `events-${me}-${events[0].id}-${events[events.length - 1].id}.zq`;
        await d.upload(name, await encrypt(key, new TextEncoder().encode(JSON.stringify(events))), { device: me, count: String(events.length) });
        seen.add(name);
        await setMeta("seenFiles", [...seen]);
      }
      await clearOutbox(ids);
      pushed += events.length;
    }

    // ---- pull ----
    let pulled = 0;
    const incoming = files.filter((f) => f.name.startsWith("events-") && !seen.has(f.name)).sort((a, b) => a.name.split("-")[2]?.localeCompare(b.name.split("-")[2] ?? "") ?? 0);
    for (const f of incoming) {
      const list = JSON.parse(new TextDecoder().decode(await decrypt(key, await d.download(f.id)))) as ZQEvent[];
      const fresh = await putEvents(list);
      for (const e of fresh) await replay(e, (ref) => fetchBlob(ref, d, key, blobFile));
      pulled += fresh.length;
      seen.add(f.name);
      await setMeta("seenFiles", [...seen]);
    }
    if (pulled) await rebuildMemory();
    return setSyncState({ lastSync: new Date().toISOString(), lastError: undefined, pushed, pulled, photos });
  } catch (e: any) {
    await setSyncState({ lastError: e?.message ?? String(e) });
    throw e;
  }
}

async function fetchBlob(ref: BlobRef, d: Drive, key: CryptoKey, files: Map<string, DFile>): Promise<Blob | undefined> {
  const f = files.get(ref.hash);
  if (!f) return undefined;
  const bytes = await decrypt(key, await d.download(f.id));
  return new Blob([bytes], { type: f.appProperties?.type ?? "image/jpeg" });
}

async function outboxIds(): Promise<string[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction("outbox", "readonly").objectStore("outbox").getAllKeys();
    r.onsuccess = () => resolve((r.result as string[]).sort());
    r.onerror = () => reject(r.error);
  });
}

async function clearOutbox(ids: string[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("outbox", "readwrite");
    for (const id of ids) t.objectStore("outbox").delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function pendingCount(): Promise<number> {
  return (await outboxIds()).length;
}

/** Deletes everything Zero Q stored in your Drive. Local data stays. */
export async function wipeDrive(): Promise<number> {
  const s = await getSettings();
  const d = drive(s);
  const files = await d.list("trashed = false");
  for (const f of files) await d.remove(f.id);
  keyCache = null;
  await setMeta("seenFiles", []);
  // Next sync starts over: everything local goes up again.
  const { listEvents } = await import("./events.ts");
  const all = await listEvents();
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("outbox", "readwrite");
    for (const e of all) t.objectStore("outbox").put({ id: e.id });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  return files.length;
}
