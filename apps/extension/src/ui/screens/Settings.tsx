import { useRef, useState } from "react";
import type { WardrobeItem } from "@zq/core";
import { exportAll, importAll } from "../../lib/db.ts";
import { setSettings, type TriggerMode } from "../../lib/settings.ts";
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
            <span className="grow" style={{ color: "var(--tint)" }}>Open wardrobe in a tab</span><span className="chev">›</span>
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
          <span className="grow" style={{ color: "var(--tint)" }}>Change shortcut</span><span className="chev">›</span>
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

      <div className="group-header">Stylist</div>
      <div className="group">
        <div className="row">
          <input className="field" style={{ padding: 0 }} type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false}
            placeholder="Anthropic API key" value={st.anthropicKey} onChange={(e) => setSettings({ anthropicKey: e.target.value.trim() })} aria-label="Anthropic API key" />
        </div>
        <div className="row">
          <span className="grow">Model</span>
          <input className="field" style={{ textAlign: "right", width: "55%", padding: 0, color: "var(--label-2)" }} value={st.anthropicModel}
            onChange={(e) => setSettings({ anthropicModel: e.target.value.trim() || "claude-sonnet-5-5" })} aria-label="Model" />
        </div>
      </div>
      <p className="group-footer">Reads your photos, writes the take on each product and plans outfits. Without a key you still get colour and duplicate matching.</p>

      <div className="group-header">Try-on</div>
      <div className="group">
        <div className="row">
          <input className="field" style={{ padding: 0 }} type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false}
            placeholder="FASHN API key" value={st.fashnKey} onChange={(e) => setSettings({ fashnKey: e.target.value.trim() })} aria-label="FASHN API key" />
        </div>
        <button className="row" onClick={() => setReveal((r) => !r)}><span className="grow" style={{ color: "var(--tint)" }}>{reveal ? "Hide keys" : "Show keys"}</span></button>
      </div>
      <p className="group-footer">Keys stay in this browser and are sent only to Anthropic and FASHN. Get one at console.anthropic.com and app.fashn.ai.</p>

      <div className="group-header">Your data</div>
      <div className="group">
        <button className="row" onClick={backup}><span className="grow" style={{ color: "var(--tint)" }}>Back up wardrobe</span><span className="value">{wardrobe.length} pieces</span></button>
        <button className="row" onClick={() => file.current?.click()}><span className="grow" style={{ color: "var(--tint)" }}>Restore from backup</span></button>
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
