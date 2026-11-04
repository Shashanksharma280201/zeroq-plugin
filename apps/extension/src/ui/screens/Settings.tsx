import { useRef, useState } from "react";
import type { WardrobeItem } from "@zq/core";
import { exportAll, importAll } from "../../lib/db.ts";
import { askAI } from "../../lib/ai.ts";
import { DEFAULTS, setSettings, type AIProvider, type TriggerMode, type TryOnProvider } from "../../lib/settings.ts";
import { Page, Segmented, useHud, useSettings } from "../components/kit.tsx";

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
    a.download = `zeroq-wardrobe-${new Date().toISOString().slice(0, 10)}.json`;
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

      <div className="group-header">Your data</div>
      <div className="group">
        <button className="row" onClick={backup}><span className="grow link">Back up wardrobe</span><span className="value">{wardrobe.length} pieces</span></button>
        <button className="row" onClick={() => file.current?.click()}><span className="grow link">Restore from backup</span></button>
      </div>
      <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try { hud(`Restored ${await importAll(f)} pieces`); } catch { hud("That file is not a Zero Q backup", "err"); }
      }} />
      <p className="group-footer">Everything lives in this Chrome profile. Back up before removing the extension.</p>
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
