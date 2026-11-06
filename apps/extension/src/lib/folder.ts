import type { ZQEvent } from "@zq/core";
import { blobHashFor, exportAll, getBlob, getMeta, listBlobKeys, listItems, setMeta } from "./db.ts";
import { deviceId, getMemory, listEvents, listRated, putEvents, rebuildMemory } from "./events.ts";
import { replay } from "./replay.ts";
import { getSettings } from "./settings.ts";

/**
 * Your data folder.
 *
 * Chrome, Edge, Brave, Opera and Arc can write to a folder you choose. Zero Q
 * keeps plain, readable files there and reads back anything another browser
 * wrote, so a folder inside Google Drive for desktop, iCloud Drive, Dropbox
 * or OneDrive keeps every browser in step without signing in here.
 *
 *   Zero Q/
 *     README.txt
 *     zeroq.json                 what this folder is, last update
 *     profile.json, wardrobe.json, memory.json, rated.json
 *     history/2026-11.jsonl      every event, one JSON per line, by month
 *     photos/wardrobe, photos/outfits, photos/rated, photos/me.jpg
 *
 * Firefox cannot pick folders, so it saves a full backup to Downloads/Zero Q instead.
 * Safari can do neither automatically; it offers a backup file.
 */

export const FOLDER_NAME = "Zero Q";
type Dir = FileSystemDirectoryHandle;

export const canPickFolder = () => typeof (globalThis as any).showDirectoryPicker === "function";
export const canSaveToDownloads = () => typeof (globalThis as any).chrome?.downloads?.download === "function";

export async function getFolder(): Promise<Dir | null> {
  return (await getMeta<Dir>("folderHandle")) ?? null;
}

export type FolderAccess = "none" | "granted" | "prompt" | "denied";

export async function folderAccess(): Promise<FolderAccess> {
  const d = await getFolder();
  if (!d) return "none";
  try {
    return ((await (d as any).queryPermission?.({ mode: "readwrite" })) ?? "granted") as FolderAccess;
  } catch {
    return "prompt";
  }
}

/** Asks again for access after a browser restart. Must run from a click. */
export async function reconnectFolder(): Promise<boolean> {
  const d = await getFolder();
  if (!d) return false;
  const r = await (d as any).requestPermission?.({ mode: "readwrite" });
  if (r && r !== "granted") return false;
  await syncFolder();
  return true;
}

/**
 * Opens the folder picker (must run from a click). If you pick a folder that
 * is not already a Zero Q folder, a "Zero Q" folder is made inside it.
 * Anything already in it is read in first.
 */
export async function chooseFolder(): Promise<{ name: string; imported: number }> {
  const picked: Dir = await (globalThis as any).showDirectoryPicker({ id: "zeroq", mode: "readwrite", startIn: "documents" });
  const dir = picked.name === FOLDER_NAME || (await exists(picked, "zeroq.json")) ? picked : await picked.getDirectoryHandle(FOLDER_NAME, { create: true });
  await setMeta("folderHandle", dir);
  await setMeta("folderLabel", dir === picked ? picked.name : `${picked.name}/${FOLDER_NAME}`);
  await setMeta("folderWritten", {});
  const imported = await importFolder(dir);
  await writeFolder(dir);
  return { name: dir.name, imported };
}

export async function forgetFolder(): Promise<void> {
  await setMeta("folderHandle", null);
  await setMeta("folderLabel", null);
}

export async function folderLabel(): Promise<string | null> {
  return (await getMeta<string>("folderLabel")) ?? null;
}

// ---------- one pass: read what others wrote, then write ours ----------

let running: Promise<FolderResult> | null = null;
export interface FolderResult {
  imported: number;
  wrote: number;
  at: string;
}

/** Safe to call often; runs one at a time and only when access is granted. */
export function syncFolder(): Promise<FolderResult | null> {
  if (running) return running;
  return (async () => {
    const dir = await getFolder();
    if (!dir || (await folderAccess()) !== "granted") return null;
    running = (async () => {
      const imported = await importFolder(dir);
      const wrote = await writeFolder(dir);
      const r = { imported, wrote, at: new Date().toISOString() };
      await setMeta("folderLast", r);
      return r;
    })().finally(() => (running = null));
    return running;
  })().catch(async (e) => {
    await setMeta("folderLast", { error: e?.message ?? String(e), at: new Date().toISOString() });
    throw e;
  });
}

export async function lastFolderSync(): Promise<(FolderResult & { error?: string }) | null> {
  return (await getMeta("folderLast")) ?? null;
}

// ---------- reading ----------

async function importFolder(dir: Dir): Promise<number> {
  const hist = await sub(dir, "history", false);
  if (!hist) return 0;
  const seen = (await getMeta<Record<string, number>>("folderSeen")) ?? {};
  let fresh: ZQEvent[] = [];
  for await (const [name, h] of (hist as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (h.kind !== "file" || !name.endsWith(".jsonl")) continue;
    const file = await (h as FileSystemFileHandle).getFile();
    if (seen[name] === file.lastModified) continue;
    const events = (await file.text())
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as ZQEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is ZQEvent => !!e?.id);
    fresh = fresh.concat(await putEvents(events, { outbox: true }));
    seen[name] = file.lastModified;
  }
  fresh.sort((a, b) => a.id.localeCompare(b.id));
  for (const e of fresh) await replay(e, (ref) => readFile(dir, photoPath(ref.key)));
  await setMeta("folderSeen", seen);
  if (fresh.length) await rebuildMemory();
  return fresh.length;
}

// ---------- writing ----------

async function writeFolder(dir: Dir): Promise<number> {
  let wrote = 0;
  const put = async (path: string, data: Blob | string) => {
    await writeFile(dir, path, data);
    wrote++;
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const now = new Date().toISOString();
  const settings = await getSettings();

  if (!(await exists(dir, "README.txt"))) await put("README.txt", README);
  await put("zeroq.json", json({ app: "Zero Q", format: 1, updatedAt: now, updatedBy: await deviceId() }));
  await put("profile.json", json((await chrome.storage.local.get("profile")).profile ?? null));
  await put("wardrobe.json", json(await listItems()));
  await put("memory.json", json(await getMemory()));
  await put("rated.json", json(await listRated()));
  await put("settings.json", json({ ...settings, geminiKey: undefined, anthropicKey: undefined, fashnKey: undefined, drivePassphrase: undefined }));

  // History by month. A month is rewritten only when it has new events.
  const byMonth = new Map<string, ZQEvent[]>();
  for (const e of await listEvents()) {
    const m = e.ts.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(e);
  }
  const counts = (await getMeta<Record<string, number>>("folderCounts")) ?? {};
  const seen = (await getMeta<Record<string, number>>("folderSeen")) ?? {};
  for (const [m, list] of byMonth) {
    if (counts[m] === list.length && (await exists(dir, `history/${m}.jsonl`))) continue;
    await put(`history/${m}.jsonl`, list.map((e) => JSON.stringify(e)).join("\n") + "\n");
    counts[m] = list.length;
    const f = await (await (await sub(dir, "history", true))!.getFileHandle(`${m}.jsonl`)).getFile();
    seen[`${m}.jsonl`] = f.lastModified; // our own write, nothing to read back
  }
  await setMeta("folderCounts", counts);
  await setMeta("folderSeen", seen);

  // Photos, each written once per version.
  const written = (await getMeta<Record<string, string>>("folderWritten")) ?? {};
  for (const key of await listBlobKeys()) {
    const path = photoPath(key);
    if (!path) continue;
    const hash = (await getMeta<string>(`hash:${key}`)) ?? (await blobHashFor(key));
    if (!hash || written[key] === hash) continue;
    const b = await getBlob(key);
    if (!b) continue;
    await put(path, b);
    written[key] = hash;
  }
  await setMeta("folderWritten", written);
  return wrote;
}

/** Blob key in IndexedDB to a readable path in the folder. */
export function photoPath(key: string): string {
  const [kind, id] = key.split(/:(.*)/s);
  const safe = (id ?? "").replace(/[^a-z0-9_-]/gi, "_");
  if (kind === "item") return `photos/wardrobe/${safe}.jpg`;
  if (kind === "outfit") return `photos/outfits/outfit-${safe}.jpg`;
  if (kind === "thumb") return `photos/rated/${safe}.jpg`;
  if (key === "me:photo") return "photos/me.jpg";
  return "";
}

// ---------- Firefox: a full backup in Downloads/Zero Q ----------

export async function saveToDownloads(): Promise<string> {
  const blob = await exportAll();
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: `${FOLDER_NAME}/zeroq-backup.json`, conflictAction: "overwrite", saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const at = new Date().toISOString();
  await setMeta("downloadsLast", at);
  return at;
}

// ---------- file helpers ----------

async function sub(dir: Dir, name: string, create: boolean): Promise<Dir | null> {
  try {
    return await dir.getDirectoryHandle(name, { create });
  } catch {
    return null;
  }
}

async function exists(dir: Dir, path: string): Promise<boolean> {
  try {
    const parts = path.split("/");
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    await d.getFileHandle(parts[parts.length - 1]);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(dir: Dir, path: string, data: Blob | string): Promise<void> {
  const parts = path.split("/");
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await (fh as any).createWritable();
  await w.write(data);
  await w.close();
}

async function readFile(dir: Dir, path: string): Promise<Blob | undefined> {
  if (!path) return undefined;
  try {
    const parts = path.split("/");
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    const f = await (await d.getFileHandle(parts[parts.length - 1])).getFile();
    return new Blob([await f.arrayBuffer()], { type: "image/jpeg" });
  } catch {
    return undefined;
  }
}

const README = `This is your Zero Q folder.

Zero Q keeps a readable copy of everything here, and reads back what your
other browsers write, so you can put this folder inside Google Drive for
desktop, iCloud Drive, Dropbox or OneDrive.

profile.json     your style profile
wardrobe.json    your clothes (photos in photos/wardrobe)
rated.json       every item you have rated, newest first (photos in photos/rated)
memory.json      what Zero Q has learned from your history
history/         every action, one JSON per line, one file per month
settings.json    your settings, without API keys

Do not edit history files by hand. To start over, delete the folder and
choose a new one in Zero Q's Settings.
`;
