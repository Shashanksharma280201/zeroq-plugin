import { deleteBlob, getBlob } from "./db.ts";
import type { CollectState, ToBackground } from "./messages.ts";

/**
 * Collecting photos of you from pages you are signed in to (Google Photos,
 * Instagram, anywhere). No account connection: you open the page, tap the
 * photos, and each one lands in Zero Q's inbox. These are the helpers for
 * Zero Q's own pages; the page side is src/collect.ts, the middle is the
 * background.
 */
export const COLLECT_KEY = "collect";
export const INBOX_KEY = "inbox";
export const GONE_KEY = "inboxGone";
export const OFF: CollectState = { on: false, room: 0, taken: 0 };
export const inboxBlobKey = (id: string) => `inbox:${id}`;

const send = (m: ToBackground) => chrome.runtime.sendMessage(m);

export async function getCollect(): Promise<CollectState> {
  return ((await chrome.storage.session.get(COLLECT_KEY))[COLLECT_KEY] as CollectState | undefined) ?? OFF;
}

/** Opens the page to collect from and switches collect mode on everywhere. */
export const startCollect = (url: string, room: number) => send({ type: "collect-start", url, room });
export const stopCollect = () => send({ type: "collect-done" });

export function onCollect(fn: (s: CollectState) => void): () => void {
  const h = (c: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "session" && c[COLLECT_KEY]) fn((c[COLLECT_KEY].newValue as CollectState) ?? OFF); };
  chrome.storage.onChanged.addListener(h);
  getCollect().then(fn);
  return () => chrome.storage.onChanged.removeListener(h);
}

/** Takes everything waiting in the inbox, and the ids of photos you un-tapped after they were taken. */
export async function takeInbox(): Promise<{ photos: Array<{ id: string; blob: Blob }>; gone: string[] }> {
  const r = (await send({ type: "inbox-take" })) as { ids: string[]; gone: string[] } | undefined;
  const photos: Array<{ id: string; blob: Blob }> = [];
  for (const id of r?.ids ?? []) {
    const blob = await getBlob(inboxBlobKey(id));
    if (blob) photos.push({ id, blob });
    deleteBlob(inboxBlobKey(id));
  }
  return { photos, gone: r?.gone ?? [] };
}

/** Calls back whenever something new is waiting. */
export function onInbox(fn: () => void): () => void {
  const h = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "session") return;
    if ((c[INBOX_KEY]?.newValue as string[] | undefined)?.length || (c[GONE_KEY]?.newValue as string[] | undefined)?.length) fn();
  };
  chrome.storage.onChanged.addListener(h);
  fn();
  return () => chrome.storage.onChanged.removeListener(h);
}

export async function inboxCount(): Promise<number> {
  return (((await chrome.storage.session.get(INBOX_KEY))[INBOX_KEY] as string[] | undefined) ?? []).length;
}
