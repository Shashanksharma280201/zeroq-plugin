import { getSettings } from "./settings.ts";

/**
 * Google Photos, the way Google allows since March 2025: the user picks
 * photos inside Google Photos and Zero Q receives only those. There is no
 * library-wide access, and no API key for the user to find. They sign in
 * with Google once and choose.
 *
 * Needs a Google OAuth client (Web application) with the Google Photos
 * Picker API enabled. While Zero Q is in development this is the client ID
 * in Settings; at launch it becomes Zero Q's own, built in.
 */

const SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const API = "https://photospicker.googleapis.com/v1";
/** Zero Q's own client ID, filled in at launch. */
export const BUILT_IN_CLIENT_ID = "";

export const googlePhotosAvailable = async () =>
  typeof chrome.identity?.launchWebAuthFlow === "function" && !!(BUILT_IN_CLIENT_ID || (await getSettings()).driveClientId);

async function token(): Promise<string> {
  const client = BUILT_IN_CLIENT_ID || (await getSettings()).driveClientId;
  if (!client) throw new Error("Google Photos is not set up yet. Add a Google client ID in Settings.");
  const cached = (await chrome.storage.session.get("photosToken")).photosToken as { token: string; exp: number; client: string } | undefined;
  if (cached && cached.client === client && cached.exp - 120_000 > Date.now()) return cached.token;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", client);
  url.searchParams.set("response_type", "token");
  url.searchParams.set("redirect_uri", chrome.identity.getRedirectURL());
  url.searchParams.set("scope", SCOPE);
  let back: string | undefined;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  } catch (e: any) {
    throw new Error(/did not approve|cancel|closed/i.test(e?.message ?? "") ? "Google sign-in was closed." : `Google sign-in failed: ${e?.message ?? e}`);
  }
  const p = new URLSearchParams(new URL(back ?? "").hash.slice(1));
  const t = p.get("access_token");
  if (!t) throw new Error(`Google sign-in failed${p.get("error") ? `: ${p.get("error")}` : "."}`);
  await chrome.storage.session.set({ photosToken: { token: t, exp: Date.now() + Number(p.get("expires_in") ?? 3600) * 1000, client } });
  return t;
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
