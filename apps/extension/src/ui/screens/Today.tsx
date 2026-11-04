import { aiReady } from "../../lib/settings.ts";
import { useEffect, useState } from "react";
import { buildOutfits, occasionFormality, type Outfit, type WardrobeItem } from "@zq/core";
import { planOutfits, wardrobeGaps } from "../../lib/ai.ts";
import { markWorn } from "../../lib/db.ts";
import { Icon, ItemImg, Page, useHud, useSettings } from "../components/kit.tsx";

const OCCASIONS = ["Everyday", "Office", "Stand out at work", "Date night", "Weekend brunch", "Wedding", "Travel"];

const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Today({ wardrobe, goWardrobe }: { wardrobe: WardrobeItem[]; goWardrobe: () => void }) {
  const settings = useSettings();
  const hud = useHud();
  const [occasion, setOccasion] = useState("Everyday");
  const [custom, setCustom] = useState("");
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [aiUsed, setAiUsed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [gaps, setGaps] = useState<string | null>(null);
  const [gapsBusy, setGapsBusy] = useState(false);
  const [round, setRound] = useState(0);
  const byId = new Map(wardrobe.map((i) => [i.id, i]));
  const tops = wardrobe.filter((i) => i.category === "top").length;
  const bottoms = wardrobe.filter((i) => i.category === "bottom").length;
  const ready = (tops > 0 && bottoms > 0) || wardrobe.some((i) => i.category === "one-piece");

  useEffect(() => {
    if (!ready || !settings) return;
    let live = true;
    setOutfits(null);
    setErr(null);
    const occ = custom.trim() || occasion;
    const offline = () => buildOutfits(wardrobe, { formality: occasionFormality(occ), count: 3 });
    if (!aiReady(settings)) {
      setOutfits(offline());
      setAiUsed(false);
      return;
    }
    planOutfits(occ, wardrobe, round ? "Give me different options from last time." : "")
      .then((o) => live && (setOutfits(o.length ? o : offline()), setAiUsed(o.length > 0)))
      .catch((e) => live && (setErr(e.message), setOutfits(offline()), setAiUsed(false)));
    return () => {
      live = false;
    };
  }, [occasion, round, ready, settings == null, settings?.aiProvider, aiReady(settings), wardrobe.length]);

  if (!ready) {
    return (
      <Page title={greeting()} serif subtitle={today()}>
        <div className="empty">
          <div className="glyph"><Icon.sun /></div>
          <h3>Outfits start with 2 pieces</h3>
          <p>Add a few tops and bottoms you own. Five of each is plenty to begin.</p>
          <button className="btn filled small" onClick={goWardrobe}>Add clothes</button>
        </div>
      </Page>
    );
  }

  const wear = async (o: Outfit) => {
    await markWorn(o.itemIds);
    hud("Enjoy your day");
  };

  return (
    <Page
      title={greeting()}
      serif
      subtitle={`${today()}. What is today for?`}
      trailing={<button className="icon-btn" aria-label="Show different outfits" onClick={() => setRound((r) => r + 1)}><Icon.sparkle /></button>}
    >
      <div className="chips" role="group" aria-label="Occasion">
        {OCCASIONS.map((o) => (
          <button key={o} className="chip" aria-pressed={!custom && occasion === o} onClick={() => { setCustom(""); setOccasion(o); }}>{o}</button>
        ))}
      </div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim()) setOccasion(custom.trim());
        }}
      >
        <Icon.search />
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Something else, like client lunch in the rain" aria-label="Describe your day" />
      </form>

      {err && <p className="error">{err} Showing quick picks instead.</p>}

      {!outfits ? (
        <div className="outfit"><div className="skeleton" style={{ height: 220, borderRadius: 14, margin: 0 }} /><div className="skeleton" style={{ width: "50%" }} /></div>
      ) : (
        <div key={`${occasion}-${round}`}>
          <div className="outfits">
          {outfits.map((o, i) => {
            const items = o.itemIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as WardrobeItem[];
            return (
              <article className="outfit" key={i}>
                <div className={`flatlay n${items.length}`}>
                  {items.map((it) => <ItemImg key={it.id} item={it} />)}
                </div>
                <div className="foot">
                  <div className="grow">
                    <div className="t">{o.title}</div>
                    <div className="w">{o.why}</div>
                  </div>
                  <button className="btn tinted small" onClick={() => wear(o)}>Wear</button>
                </div>
              </article>
            );
          })}
          </div>
          {!aiUsed && !aiReady(settings) && (
            <p className="hint" style={{ margin: "0 4px 24px" }}>These are quick colour and formality matches. Add a Gemini or Claude key in Settings for a stylist that reads the occasion.</p>
          )}
        </div>
      )}

      {aiReady(settings) && wardrobe.length >= 6 && (
        <>
          <div className="group-header">What to buy next</div>
          <div className="group">
            {gaps ? (
              <div className="row" style={{ whiteSpace: "pre-line", padding: "14px 16px" }}>{gaps}</div>
            ) : (
              <button className="row" disabled={gapsBusy} onClick={async () => {
                setGapsBusy(true);
                try { setGaps(await wardrobeGaps(wardrobe)); } catch (e: any) { hud(e.message, "err"); } finally { setGapsBusy(false); }
              }}>
                <span className="grow link">{gapsBusy ? "Looking through your wardrobe" : "Find the gaps in my wardrobe"}</span>
                <span className="chev">›</span>
              </button>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
