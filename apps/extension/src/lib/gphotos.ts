import { googleRedirect } from "./platform.ts";
import { getSettings, setSettings } from "./settings.ts";

/**
 * Google Photos, by permission.
 *
 * The only access Google gives third-party apps since March 2025 is its own
 * picker: you sign in with Google, allow Zero Q to "see the photos you
 * select", choose photos inside Google Photos, and Zero Q receives only
 * those. It never sees the rest of your library.
 *
 * Sign-in needs one Google OAuth client (type Web application, with the
 * Google Photos Picker API switched on). Zero Q's own client ID is built in
 * from google.json; until that is filled in, a client ID typed into Settings
 * is used instead. See docs/google-photos.md.
 */

const SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const API = "https://photospicker.googleapis.com/v1";
declare const __ZQ_GOOGLE_CLIENT_ID__: string;
/** Zero Q's own client ID, put in at build time. */
export const BUILT_IN_CLIENT_ID: string = typeof __ZQ_GOOGLE_CLIENT_ID__ === "string" ? __ZQ_GOOGLE_CLIENT_ID__ : "";

export const googleClientId = async () => BUILT_IN_CLIENT_ID || (await getSettings()).driveClientId;

/**
 * unsupported: this browser has no web sign-in for extensions (Safari).
 * setup: no Google client ID yet. ready: one click from Google's permission
 * screen. connected: you have already said yes.
 */
export type PhotosStatus = "unsupported" | "setup" | "ready" | "connected";

export async function photosStatus(): Promise<PhotosStatus> {
  if (typeof chrome.identity?.launchWebAuthFlow !== "function") return "unsupported";
  if (!(await googleClientId())) return "setup";
  return (await getSettings()).photosConnected ? "connected" : "ready";
}

export const googlePhotosAvailable = async () => ["ready", "connected"].includes(await photosStatus());

/** The address Google's permission screen is opened at. */
export function authUrl(client: string, redirect: string, silent = false): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", client);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", SCOPE);
  if (silent) url.searchParams.set("prompt", "none");
  return url.toString();
}

async function token(): Promise<string> {
  const client = await googleClientId();
  if (!client) throw new Error("Google Photos is not switched on yet. It needs a Google client ID.");
  const cached = (await chrome.storage.session.get("photosToken")).photosToken as { token: string; exp: number; client: string } | undefined;
  if (cached && cached.client === client && cached.exp - 120_000 > Date.now()) return cached.token;
  const read = async (back?: string) => {
    const p = new URLSearchParams(new URL(back ?? "").hash.slice(1));
    const t = p.get("access_token");
    if (!t) throw new Error(p.get("error") ?? "no token");
    await chrome.storage.session.set({ photosToken: { token: t, exp: Date.now() + Number(p.get("expires_in") ?? 3600) * 1000, client } });
    return t;
  };
  // You said yes before: renew quietly, with no window, while Google still remembers.
  if ((await getSettings()).photosConnected) {
    try { return await read(await chrome.identity.launchWebAuthFlow({ url: authUrl(client, googleRedirect(), true), interactive: false })); } catch {}
  }
  let back: string | undefined;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: authUrl(client, googleRedirect()), interactive: true });
  } catch (e: any) {
    throw new Error(/did not approve|cancel|closed/i.test(e?.message ?? "") ? "Google sign-in was closed before you gave permission." : `Google sign-in failed: ${e?.message ?? e}`);
  }
  try {
    return await read(back);
  } catch (e: any) {
    throw new Error(e?.message === "access_denied"
      ? "Google did not give permission. If you pressed Cancel, try again. While Zero Q is in testing, your Google account also has to be on its tester list."
      : `Google sign-in failed: ${e?.message ?? "no answer"}.`);
  }
}

/** Opens Google's permission screen. Must start from a click. */
export async function connectGooglePhotos(): Promise<void> {
  await token();
  await setSettings({ photosConnected: true });
}

/** Takes the permission back: the token is revoked at Google and forgotten here. */
export async function disconnectGooglePhotos(): Promise<void> {
  const cached = (await chrome.storage.session.get("photosToken")).photosToken as { token: string } | undefined;
  if (cached?.token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cached.token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => {});
  await chrome.storage.session.remove("photosToken");
  await setSettings({ photosConnected: false });
}

async function call(t: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${t}`, "content-type": "application/json" } });
  if (!r.ok) {
    if (r.status === 403) throw new Error("Google Photos refused. Turn on the Google Photos Picker API for this client in Google Cloud.");
    throw new Error(`Google Photos ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  }
  return r.status === 204 ? null : r.json();
}

const secs = (d?: string, fallback = 3) => (d ? parseFloat(d) : fallback) * 1000;

/**
 * Runs the whole pick: sign in, open Google Photos, wait for "Done",
 * download the chosen photos (within their 60-minute window), clean up.
 * Must start from a click: it opens a sign-in and a Google Photos window.
 */
export async function pickFromGooglePhotos(max: number, onStage?: (s: "signin" | "picking" | "downloading", done?: number, total?: number) => void): Promise<Blob[]> {
  onStage?.("signin");
  const t = await token();
  if (!(await getSettings()).photosConnected) await setSettings({ photosConnected: true });
  const session = await call(t, "/sessions", { method: "POST", body: JSON.stringify({ pickingConfig: { maxItemCount: String(Math.max(1, Math.min(2000, max))) } }) });
  onStage?.("picking");
  const win = await chrome.windows.create({ url: `${session.pickerUri}/autoclose`, type: "popup", width: 1100, height: 820, focused: true }).catch(() => null);
  try {
    let s = session;
    const until = Date.now() + secs(s.pollingConfig?.timeoutIn, 900);
    while (!s.mediaItemsSet) {
      if (Date.now() > until) throw new Error("Google Photos timed out. Try again.");
      await new Promise((r) => setTimeout(r, Math.max(1000, secs(s.pollingConfig?.pollInterval))));
      s = await call(t, `/sessions/${session.id}`);
      // closed without choosing anything
      if (!s.mediaItemsSet && win?.id != null && !(await chrome.windows.get(win.id).catch(() => null))) {
        await new Promise((r) => setTimeout(r, 1500));
        s = await call(t, `/sessions/${session.id}`);
        if (!s.mediaItemsSet) return [];
      }
    }
    const items: any[] = [];
    let page = "";
    do {
      const r = await call(t, `/mediaItems?sessionId=${session.id}&pageSize=100${page ? `&pageToken=${page}` : ""}`);
      items.push(...(r.mediaItems ?? []));
      page = r.nextPageToken ?? "";
    } while (page);
    const photos = items.filter((i) => i.type !== "VIDEO" && i.mediaFile?.baseUrl).slice(0, max);
    const out: Blob[] = [];
    for (const [n, it] of photos.entries()) {
      onStage?.("downloading", n, photos.length);
      const r = await fetch(`${it.mediaFile.baseUrl}=w1600-h1600`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) out.push(await r.blob());
    }
    return out;
  } finally {
    call(t, `/sessions/${session.id}`, { method: "DELETE" }).catch(() => {});
    if (win?.id != null) chrome.windows.remove(win.id).catch(() => {});
  }
}
