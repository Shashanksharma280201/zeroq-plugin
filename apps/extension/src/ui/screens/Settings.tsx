import { useEffect, useRef, useState } from "react";
import { clearHistory, countEvents } from "../../lib/events.ts";
import { canSignIn } from "../../lib/platform.ts";
import { connectDrive, disconnectDrive, getSyncState, onSyncState, pendingCount, redirectUrl, wipeDrive, type SyncState } from "../../lib/sync.ts";
import type { WardrobeItem } from "@zq/core";
import { exportAll, importAll } from "../../lib/db.ts";
import { askAI } from "../../lib/ai.ts";
import { DEFAULTS, setSettings, type Settings as SettingsT, type AIProvider, type TriggerMode, type TryOnProvider } from "../../lib/settings.ts";
import { Page, Segmented, Switch, useHud, useSettings } from "../components/kit.tsx";
import { DataHomeSettings } from "../components/DataHome.tsx";

const TRIGGER_HELP: Record<TriggerMode, string> = {
  auto: "A small button appears on product pages with what Zero Q found. Click it to open the panel.",
  quiet: "No button on pages. The toolbar icon shows a badge: a number for matches, ! for something you already own.",
  off: "Zero Q only checks a page when you open it with the shortcut or the toolbar icon.",
};

export function Settings({ wardrobe, surface }: { wardrobe: WardrobeItem[]; surface: "sidepanel" | "app" }) {
  const st = useSettings();
  const hud = useHud();
  const file = useRef<HTMLInputElement>(null);
  const [reveal, setReveal] = useState(false);
  if (!st) return null;

  const backup = async () => {
    const blob = await exportAll();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zeroq-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <Page title="Settings">
      {surface === "sidepanel" && (
        <div className="group">
          <button className="row" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("app.html") })}>
            <span className="grow link">Open wardrobe in a tab</span><span className="chev">›</span>
          </button>
        </div>
      )}

      <div className="group-header">On shopping sites</div>
      <Segmented<TriggerMode>
        label="When to show Zero Q"
        value={st.trigger}
        onChange={(v) => setSettings({ trigger: v })}
        options={[{ value: "auto", label: "Button" }, { value: "quiet", label: "Badge only" }, { value: "off", label: "Shortcut only" }]}
      />
      <p className="group-footer" style={{ marginTop: -8 }}>{TRIGGER_HELP[st.trigger]}</p>

      <div className="group">
        <div className="row"><span className="grow">Open on any page</span><kbd>Alt</kbd><kbd>Shift</kbd><kbd>Z</kbd></div>
        <button className="row" onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
          <span className="grow link">Change shortcut</span><span className="chev">›</span>
        </button>
      </div>

      {st.mutedSites.length > 0 && (
        <>
          <div className="group-header">Hidden on</div>
          <div className="group">
            {st.mutedSites.map((h) => (
              <div className="row" key={h}>
                <span className="grow">{h}</span>
                <button className="btn plain" onClick={() => setSettings({ mutedSites: st.mutedSites.filter((x) => x !== h) })}>Show again</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="group-header">AI for styling and ratings</div>
      <Segmented<AIProvider> label="AI provider" value={st.aiProvider} onChange={(v) => setSettings({ aiProvider: v })}
        options={[{ value: "gemini", label: "Gemini" }, { value: "claude", label: "Claude" }]} />
      <div className="group">
        {st.aiProvider === "gemini" ? (
          <>
            <KeyRow label="Gemini API key" placeholder="AIza..." value={st.geminiKey} reveal={reveal} onChange={(v) => setSettings({ geminiKey: v })} />
            <ModelRow value={st.geminiModel} fallback={DEFAULTS.geminiModel} onChange={(v) => setSettings({ geminiModel: v })} />
          </>
        ) : (
          <>
            <KeyRow label="Claude API key" placeholder="sk-ant-..." value={st.anthropicKey} reveal={reveal} onChange={(v) => setSettings({ anthropicKey: v })} />
            <ModelRow value={st.anthropicModel} fallback={DEFAULTS.anthropicModel} onChange={(v) => setSettings({ anthropicModel: v })} />
          </>
        )}
        <TestRow kind="ai" />
      </div>
      <p className="group-footer">{st.aiProvider === "gemini"
        ? "Get a key at aistudio.google.com/apikey. Turn on billing: on the free tier Google may use what you send, including your photos, to train its models."
        : "Get a key at console.anthropic.com. Billed by use, separate from a Claude subscription."} Without a key you still get colour and duplicate matching.</p>

      <div className="group-header">Try-on</div>
      <Segmented<TryOnProvider> label="Try-on provider" value={st.tryOnProvider} onChange={(v) => setSettings({ tryOnProvider: v })}
        options={[{ value: "gemini", label: "Gemini" }, { value: "fashn", label: "FASHN" }]} />
      <div className="group">
        {st.tryOnProvider === "gemini" ? (
          <>
            {!st.geminiKey && <KeyRow label="Gemini API key" placeholder="AIza..." value={st.geminiKey} reveal={reveal} onChange={(v) => setSettings({ geminiKey: v })} />}
            <ModelRow value={st.geminiImageModel} fallback={DEFAULTS.geminiImageModel} onChange={(v) => setSettings({ geminiImageModel: v })} />
          </>
        ) : (
          <KeyRow label="FASHN API key" placeholder="FASHN API key" value={st.fashnKey} reveal={reveal} onChange={(v) => setSettings({ fashnKey: v })} />
        )}
        <button className="row" onClick={() => setReveal((r) => !r)}><span className="grow link">{reveal ? "Hide keys" : "Show keys"}</span></button>
      </div>
      <p className="group-footer">{st.tryOnProvider === "gemini"
        ? "Uses the same Gemini key. Image editing needs billing on; about 4 to 7 cents an image. Other models to try: gemini-nano-banana-2.1, gemini-3-pro-image."
        : "Purpose-built try-on that keeps your face and body intact. Get a key at app.fashn.ai, about 7.5 cents an image."} Keys stay in this browser.</p>

      <div className="group-header">Suggestions</div>
      <div className="group">
        <div className="row">
          <span className="grow">Show picks outside your usual</span>
          <Switch on={st.stretchPicks} onChange={(v) => setSettings({ stretchPicks: v })} label="Show picks outside your usual" />
        </div>
      </div>
      <p className="group-footer">Up to 2 pieces per list that break your budget, occasion or colours when your history says you would like them anyway. Never-wear items are never shown.</p>

      <DataHomeSettings st={st} />

      <DriveSync st={st} />

      <div className="group-header">Your data</div>
      <div className="group">
        <button className="row" onClick={backup}><span className="grow link">Back up everything</span><span className="value">{wardrobe.length} pieces</span></button>
        <button className="row" onClick={() => file.current?.click()}><span className="grow link">Restore from backup</span></button>
        <ClearHistory />
      </div>
      <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try { hud(`Restored ${await importAll(f)} pieces`); } catch { hud("That file is not a Zero Q backup", "err"); }
      }} />
      <p className="group-footer">A backup holds your wardrobe, profile, photos and full history. Zero Q keeps everything you do forever unless you clear it here.</p>
    </Page>
  );
}

function KeyRow({ label, placeholder, value, reveal, onChange }: { label: string; placeholder: string; value: string; reveal: boolean; onChange: (v: string) => void }) {
  return (
    <div className="row">
      <input className="field" style={{ padding: 0 }} type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false}
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value.trim())} aria-label={label} />
    </div>
  );
}

function ModelRow({ value, fallback, onChange }: { value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <div className="row">
      <span className="grow">Model</span>
      <input className="field" style={{ textAlign: "right", width: "62%", padding: 0, color: "var(--muted)" }} value={value} spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim() || fallback)} aria-label="Model" />
    </div>
  );
}

/** One tiny request so you know the key and model work before onboarding. */
function TestRow({ kind }: { kind: "ai" }) {
  const [state, setState] = useState<{ busy: boolean; msg?: string; ok?: boolean }>({ busy: false });
  const run = async () => {
    setState({ busy: true });
    try {
      const t = await askAI("Reply with exactly the word: ready", [{ type: "text", text: "Are you there?" }], { maxTokens: 20 });
      setState({ busy: false, ok: true, msg: `Connected. It said "${t.trim().slice(0, 40)}".` });
    } catch (e: any) {
      setState({ busy: false, ok: false, msg: e.message ?? String(e) });
    }
  };
  return (
    <button className="row" onClick={run} disabled={state.busy} data-kind={kind}>
      <span className="grow">
        <span className="link">{state.busy ? "Testing" : "Test connection"}</span>
        {state.msg && <div className="meta" style={{ color: state.ok ? "var(--positive)" : "var(--negative)" }}>{state.msg}</div>}
      </span>
    </button>
  );
}

function ClearHistory() {
  const hud = useHud();
  const [n, setN] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    countEvents().then(setN);
  }, [sure]);
  return (
    <button className="row" onClick={async () => {
      if (!sure) return setSure(true);
      await clearHistory();
      setSure(false);
      hud("History cleared");
    }} onBlur={() => setSure(false)}>
      <span className="grow danger-link">{sure ? "Tap again to clear history" : "Clear history"}</span>
      <span className="value">{n ?? ""}{n != null ? " events" : ""}</span>
    </button>
  );
}

/**
 * Google Drive sync. You bring a free OAuth client ID from Google Cloud and
 * a passphrase; Zero Q writes encrypted files to a hidden folder only it can see.
 */
function DriveSync({ st }: { st: SettingsT }) {
  const hud = useHud();
  const [state, setState] = useState<SyncState>({});
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState<"" | "connect" | "sync" | "wipe">("");
  const [err, setErr] = useState<string | null>(null);
  const [wipeSure, setWipeSure] = useState(false);
  useEffect(() => {
    getSyncState().then(setState);
    pendingCount().then(setPending);
    return onSyncState((s) => (setState(s), pendingCount().then(setPending)));
  }, []);

  if (!canSignIn()) {
    return (
      <>
        <div className="group-header">Google Drive sync</div>
        <p className="group-footer" style={{ marginTop: 0 }}>This browser cannot sign in to Google from an extension, so sync is off here. Your history is still saved in this browser; use Back up and Restore below to move it.</p>
      </>
    );
  }

  const sync = async () => {
    setBusy("sync");
    setErr(null);
    const r = await chrome.runtime.sendMessage({ type: "sync-now" }).catch((e: any) => ({ ok: false, error: e.message }));
    if (!r?.ok) setErr(r?.error ?? "Sync failed");
    else hud(r.state?.pulled ? `Synced, ${r.state.pulled} new from your other browsers` : "Synced");
    setBusy("");
  };
  const connect = async () => {
    setBusy("connect");
    setErr(null);
    try {
      await connectDrive();
      await setSettings({ driveSync: true });
      setBusy("");
      await sync();
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setBusy("");
    }
  };
  const on = st.driveSync && !!state.email;

  return (
    <>
      <div className="group-header">Google Drive sync</div>
      {on ? (
        <div className="group">
          <div className="row"><span className="grow">Connected</span><span className="value truncate" style={{ maxWidth: "60%" }}>{state.email}</span></div>
          <div className="row">
            <span className="grow">Last sync</span>
            <span className="value">{state.lastSync ? new Date(state.lastSync).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Not yet"}{pending ? `, ${pending} waiting` : ""}</span>
          </div>
          <button className="row" onClick={sync} disabled={!!busy}><span className="grow link">{busy === "sync" ? "Syncing" : "Sync now"}</span></button>
          <button className="row" onClick={async () => { await disconnectDrive(); await setSettings({ driveSync: false }); hud("Sync turned off"); }}><span className="grow link">Turn off sync</span></button>
          <button className="row" disabled={!!busy} onBlur={() => setWipeSure(false)} onClick={async () => {
            if (!wipeSure) return setWipeSure(true);
            setBusy("wipe");
            try { hud(`Deleted ${await wipeDrive()} files from Drive`); } catch (e: any) { setErr(e.message); }
            setBusy(""); setWipeSure(false);
          }}><span className="grow danger-link">{busy === "wipe" ? "Deleting" : wipeSure ? "Tap again to delete Zero Q's Drive data" : "Delete Zero Q data from Drive"}</span></button>
        </div>
      ) : (
        <div className="group">
          <div className="row">
            <input className="field" style={{ padding: 0 }} spellCheck={false} autoComplete="off" placeholder="OAuth client ID (….apps.googleusercontent.com)"
              value={st.driveClientId} onChange={(e) => setSettings({ driveClientId: e.target.value.trim() })} aria-label="Google OAuth client ID" />
          </div>
          <div className="row">
            <input className="field" style={{ padding: 0 }} type="password" autoComplete="new-password" placeholder="Passphrase, 8 characters or more"
              value={st.drivePassphrase} onChange={(e) => setSettings({ drivePassphrase: e.target.value })} aria-label="Sync passphrase" />
          </div>
          <button className="row" onClick={connect} disabled={!!busy || !st.driveClientId || st.drivePassphrase.length < 8}>
            <span className="grow link">{busy === "connect" ? "Connecting" : busy === "sync" ? "Syncing" : "Connect Google Drive"}</span>
          </button>
        </div>
      )}
      {(err || state.lastError) && <p className="error" style={{ margin: "-16px 4px 24px" }}>{err ?? state.lastError}</p>}
      {on ? (
        <p className="group-footer">Your history, wardrobe, profile and photos sync every 15 minutes to a hidden Zero Q folder in your Drive, encrypted with your passphrase. Use the same client ID and passphrase in your other browsers.</p>
      ) : (
        <details className="setup-steps">
          <summary>How to get a client ID (5 minutes, free)</summary>
          <ol>
            <li>Open console.cloud.google.com, create a project, and enable the <b>Google Drive API</b>.</li>
            <li>Under Google Auth Platform, set up the consent screen (External) and add yourself as a test user.</li>
            <li>Create an OAuth client of type <b>Web application</b>.</li>
            <li>Add this as an authorised redirect URI:<code className="copy" onClick={() => navigator.clipboard.writeText(redirectUrl()).then(() => hud("Copied"))}>{redirectUrl()}</code></li>
            <li>Paste the client ID above, choose a passphrase, and connect. Every browser you sync needs its own redirect URI added to the same client.</li>
          </ol>
          <p>If you lose the passphrase, the Drive copy cannot be read. What is in this browser is unaffected.</p>
        </details>
      )}
    </>
  );
}
