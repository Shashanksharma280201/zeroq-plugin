import { useEffect, useState } from "react";
import {
  canPickFolder, canSaveToDownloads, chooseFolder, folderAccess, folderLabel, forgetFolder, lastFolderSync, reconnectFolder, saveToDownloads, syncFolder,
  type FolderAccess,
} from "../../lib/folder.ts";
import { getMeta } from "../../lib/db.ts";
import { onEvents } from "../../lib/events.ts";
import { setSettings, type Settings } from "../../lib/settings.ts";
import { OS_NAME, browserDataPath, orList, cloudFolders, detectBrowser, detectOS, downloadsFolder, suggestedFolder } from "../../lib/where.ts";
import { Sheet, useHud, useSettings } from "./kit.tsx";

const os = detectOS();
const browser = detectBrowser();
const inBrowserPath = () => browserDataPath(os, browser, chrome.runtime.id);

function useFolderState() {
  const [access, setAccess] = useState<FolderAccess>("none");
  const [label, setLabel] = useState<string | null>(null);
  const [last, setLast] = useState<{ at: string; error?: string } | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    folderAccess().then(setAccess);
    folderLabel().then(setLabel);
    lastFolderSync().then(setLast);
  }, [bump]);
  return { access, label, last, refresh: () => setBump((b) => b + 1) };
}

/** Keeps the folder up to date while Zero Q is open: on open, then a few seconds after anything new. */
export function useFolderAutosave(settings: Settings | null) {
  useEffect(() => {
    if (settings?.dataHome !== "folder") return;
    let t: ReturnType<typeof setTimeout> | undefined;
    syncFolder().catch(() => {});
    const off = onEvents((e) => {
      if (e.kind !== "event") return;
      clearTimeout(t);
      t = setTimeout(() => syncFolder().catch(() => {}), 4000);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [settings?.dataHome]);
}

/** Asked once, the first time Zero Q opens after this update. */
export function DataHomeSheet() {
  const settings = useSettings();
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = settings?.dataHome === "unset";

  const pick = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await chooseFolder();
      await setSettings({ dataHome: "folder" });
      hud(r.imported ? `Saving to ${r.name}. Read ${r.imported} things from it.` : `Saving to ${r.name}`);
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(pickerError(e));
    } finally {
      setBusy(false);
    }
  };
  const downloads = async () => {
    setBusy(true);
    try {
      await saveToDownloads();
      await setSettings({ dataHome: "downloads" });
      hud("Saved to Downloads/Zero Q");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => setSettings({ dataHome: "browser" })} title="Your data">
      <div className="datahome">
        <h2 className="dh-title">Where should Zero Q keep your data?</h2>
        <p className="dh-lead">Your profile, wardrobe, every item you rate with its photo, and your full history.</p>

        <div className="dh-now">
          <div className="caps">Right now</div>
          <p>Inside {browser} on {OS_NAME[os]}, in a database only {browser} can open:</p>
          <code>{inBrowserPath()}</code>
          <p className="hint">Clearing browsing data or removing Zero Q deletes it.</p>
        </div>

        {canPickFolder() ? (
          <div className="dh-option">
            <button className="btn filled block" onClick={pick} disabled={busy}>{busy ? "Waiting for the folder" : "Choose a folder"}</button>
            <p>Suggested:</p>
            <code>{suggestedFolder(os)}</code>
            <p className="hint">In the window that opens, go to {os === "chromeos" ? "My files" : "Documents"} and click Select. Zero Q makes a "Zero Q" folder inside with readable files and photos.</p>
            <p className="hint">Pick a folder inside {orList(cloudFolders(os))} and it is backed up and shared with your other browsers, with no sign-in here.</p>
          </div>
        ) : canSaveToDownloads() ? (
          <div className="dh-option">
            <button className="btn filled block" onClick={downloads} disabled={busy}>Save a copy to Downloads</button>
            <code>{downloadsFolder(os)}</code>
            <p className="hint">{browser} does not let extensions pick a folder, so Zero Q saves a full backup there now and once a day, replacing the last one.</p>
          </div>
        ) : (
          <div className="dh-option">
            <p className="hint">{browser} does not let extensions save to a folder on their own. Use Back up everything in Settings whenever you want a copy; it goes to your Downloads folder.</p>
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn plain block" onClick={() => setSettings({ dataHome: "browser" })}>Keep it in the browser only</button>
        <p className="hint" style={{ textAlign: "center" }}>You can change this any time in Settings.</p>
      </div>
    </Sheet>
  );
}

/** After a browser restart, Chrome may ask again before Zero Q can write to the folder. */
export function FolderBanner() {
  const settings = useSettings();
  const { access, label, refresh } = useFolderState();
  const hud = useHud();
  if (settings?.dataHome !== "folder" || access !== "prompt") return null;
  return (
    <div className="folder-banner" role="status">
      <span>Allow Zero Q to keep saving to <b>{label ?? "your folder"}</b>.</span>
      <button className="btn filled small" onClick={async () => {
        const ok = await reconnectFolder().catch(() => false);
        refresh();
        hud(ok ? "Saving to your folder again" : "Not allowed", ok ? undefined : "err");
      }}>Allow</button>
    </div>
  );
}

/** The "Where your data lives" section in Settings. */
export function DataHomeSettings({ st }: { st: Settings }) {
  const hud = useHud();
  const { access, label, last, refresh } = useFolderState();
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState<string | null>(null);
  useEffect(() => {
    getMeta<string>("downloadsLast").then((x) => setDl(x ?? null));
  }, [busy]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      hud(ok);
    } catch (e: any) {
      if (e?.name !== "AbortError") hud(pickerError(e), "err");
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Not yet");
  const folderOn = st.dataHome === "folder" && !!label;

  return (
    <>
      <div className="group-header">Where your data lives</div>
      <div className="group">
        <button className="row" onClick={() => navigator.clipboard.writeText(inBrowserPath()).then(() => hud("Path copied"))}>
          <span className="grow">
            <span>In {browser}</span>
            <div className="meta path">{inBrowserPath()}</div>
          </span>
        </button>
        {folderOn ? (
          <>
            <div className="row">
              <span className="grow">
                <span>Folder: {label}</span>
                <div className="meta">{access === "prompt" ? "Needs your permission again" : last?.error ? `Last save failed: ${last.error}` : `Last saved ${when(last?.at)}`}</div>
              </span>
            </div>
            {access === "prompt" ? (
              <button className="row" disabled={busy} onClick={() => run(reconnectFolder, "Saving to your folder again")}><span className="grow link">Allow saving to the folder</span></button>
            ) : (
              <button className="row" disabled={busy} onClick={() => run(syncFolder, "Saved")}><span className="grow link">{busy ? "Saving" : "Save now"}</span></button>
            )}
            <button className="row" disabled={busy} onClick={() => run(chooseFolder, "Folder changed")}><span className="grow link">Change folder</span></button>
            <button className="row" onClick={() => run(async () => { await forgetFolder(); await setSettings({ dataHome: "browser" }); }, "Stopped saving to the folder")}><span className="grow link">Stop saving to the folder</span></button>
          </>
        ) : canPickFolder() ? (
          <button className="row" disabled={busy} onClick={() => run(async () => { await chooseFolder(); await setSettings({ dataHome: "folder" }); }, "Saving to your folder")}>
            <span className="grow"><span className="link">Choose a folder</span><div className="meta path">Suggested: {suggestedFolder(os)}</div></span>
          </button>
        ) : canSaveToDownloads() ? (
          <>
            <button className="row" disabled={busy} onClick={() => run(async () => { await saveToDownloads(); await setSettings({ dataHome: "downloads" }); }, "Saved to Downloads/Zero Q")}>
              <span className="grow"><span className="link">{st.dataHome === "downloads" ? "Save a copy now" : "Save a copy to Downloads daily"}</span><div className="meta path">{downloadsFolder(os)}{st.dataHome === "downloads" ? `, last ${when(dl)}` : ""}</div></span>
            </button>
            {st.dataHome === "downloads" && <button className="row" onClick={() => setSettings({ dataHome: "browser" })}><span className="grow link">Stop daily copies</span></button>}
          </>
        ) : null}
      </div>
      <p className="group-footer">
        {canPickFolder()
          ? `The folder holds readable files: profile, wardrobe, rated items with photos, and full history. Inside ${cloudFolders(os)[0]} or similar, it backs up and keeps your browsers in step.`
          : canSaveToDownloads()
            ? `${browser} cannot pick folders, so Zero Q saves a full backup file to your downloads folder once a day.`
            : `${browser} cannot save to a folder by itself. Use Back up everything below for a copy.`}
      </p>
    </>
  );
}

function pickerError(e: any): string {
  const m = e?.message ?? String(e);
  if (/system|not allowed|security/i.test(m)) return "That folder is protected by the system. Pick one inside Documents or your home folder.";
  return m;
}
