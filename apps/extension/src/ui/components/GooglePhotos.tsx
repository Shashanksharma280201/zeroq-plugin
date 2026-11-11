import { useEffect, useState } from "react";
import { BUILT_IN_CLIENT_ID, connectGooglePhotos, disconnectGooglePhotos, photosStatus, type PhotosStatus } from "../../lib/gphotos.ts";
import { googleRedirect } from "../../lib/platform.ts";
import { setSettings } from "../../lib/settings.ts";
import { Icon, Sheet, useHud, useSettings } from "./kit.tsx";

/** Where Google Photos stands right now; follows settings as they change. */
export function usePhotosStatus(): PhotosStatus | null {
  const st = useSettings();
  const [status, setStatus] = useState<PhotosStatus | null>(null);
  useEffect(() => { photosStatus().then(setStatus); }, [st?.photosConnected, st?.driveClientId]);
  return status;
}

/**
 * Asks before Google asks. Says in plain words what Google is about to show
 * and what Zero Q will and will not see, then opens Google's own permission
 * screen. When Zero Q has no Google client ID yet, it says what is missing.
 */
export function GooglePhotosSheet({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const status = usePhotosStatus();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await connectGooglePhotos();
      onConnected();
    } catch (e: any) {
      setErr(e?.message ?? "Google sign-in did not finish.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Google Photos">
      {status === "setup" ? <PhotosSetup /> : (
        <div className="gp">
          <h2 className="gp-title">Connect Google Photos</h2>
          <ol className="gp-steps">
            <li><span className="gp-ic"><Icon.person /></span><div><b>Sign in with Google</b><p>In Google's own window. Zero Q never sees your password.</p></div></li>
            <li><span className="gp-ic"><Icon.check /></span><div><b>Give permission</b><p>Google asks whether Zero Q may see the photos you select. Nothing else is asked for.</p></div></li>
            <li><span className="gp-ic"><Icon.photos /></span><div><b>Pick your photos</b><p>You choose inside Google Photos. Zero Q gets only those, never the rest of your library.</p></div></li>
          </ol>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn filled block" onClick={connect} disabled={busy}>{busy ? "Waiting for Google" : "Continue with Google"}</button>
          <p className="hint center">You can take the permission back any time in Me.</p>
        </div>
      )}
    </Sheet>
  );
}

/** Shown only while Zero Q has no Google client ID: what is missing, and where to put it. */
function PhotosSetup() {
  const st = useSettings();
  const hud = useHud();
  const redirect = googleRedirect();
  return (
    <div className="gp">
      <h2 className="gp-title">One thing is missing</h2>
      <p className="gp-lead">Google only shows its permission screen to apps it knows. Zero Q needs a Google client ID for that. It is set once by whoever builds Zero Q, not by each person who uses it.</p>
      <ol className="setup-list">
        <li>Open console.cloud.google.com, create a project and turn on the <b>Google Photos Picker API</b>.</li>
        <li>Set up the consent screen (External) and add your Google account as a test user.</li>
        <li>Create an OAuth client of type <b>Web application</b> with this redirect address:
          <code className="copy" onClick={() => navigator.clipboard.writeText(redirect).then(() => hud("Copied"))}>{redirect}</code></li>
        <li>Paste the client ID here.</li>
      </ol>
      <label className="su-field"><span>Google client ID</span>
        <input spellCheck={false} autoComplete="off" placeholder="….apps.googleusercontent.com" value={st?.driveClientId ?? ""} onChange={(e) => setSettings({ driveClientId: e.target.value.trim() })} />
      </label>
      <p className="hint">The full guide is in docs/google-photos.md. The same client ID also runs Google Drive sync.</p>
    </div>
  );
}

/** The Google Photos section in Me: connect, or take the permission back. */
export function GooglePhotosSettings() {
  const status = usePhotosStatus();
  const hud = useHud();
  const [ask, setAsk] = useState(false);
  // without a Google client ID, photos come in by tapping them on the Google Photos page instead
  if (!status || status === "unsupported" || status === "setup") return null;
  return (
    <>
      <div className="group-header">Google Photos</div>
      <div className="group">
        <div className="row"><span className="grow">{status === "connected" ? "Connected" : status === "ready" ? "Not connected" : "Not switched on yet"}
          <div className="meta">{status === "connected" ? "Zero Q can open your Google Photos picker. It sees only the photos you pick." : status === "ready" ? "Pick outfit photos straight from your library." : "Needs a Google client ID first."}</div></span></div>
        {status === "connected"
          ? <button className="row" onClick={async () => { await disconnectGooglePhotos(); hud("Google Photos disconnected"); }}><span className="grow danger-link">Disconnect Google Photos</span></button>
          : <button className="row" onClick={() => setAsk(true)}><span className="grow link">{status === "ready" ? "Connect Google Photos" : "Set it up"}</span></button>}
      </div>
      {!BUILT_IN_CLIENT_ID && <p className="group-footer">Using the Google client ID from the Drive sync section below.</p>}
      <GooglePhotosSheet open={ask} onClose={() => setAsk(false)} onConnected={() => { setAsk(false); hud("Google Photos connected"); }} />
    </>
  );
}
