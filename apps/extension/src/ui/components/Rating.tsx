import { aiReady, PROVIDER_NAME } from "../../lib/settings.ts";
import { useEffect, useRef, useState } from "react";
import { deltaE, type WardrobeItem } from "@zq/core";
import { srcToBlob } from "../../lib/images.ts";
import type { ToContent } from "../../lib/messages.ts";
import { rateItem, type Rating, type StyleProfile } from "../../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon, ItemImg, useSettings } from "./kit.tsx";

const cache = new Map<string, Rating>();
export const cachedRating = (src: string) => cache.get(src);

/**
 * Rates one image for you and renders the result. Also mirrors progress to
 * the card pinned on the page, so the answer shows up where you pointed.
 */
export function RatingPanel({
  src, title, url, hint, profile, wardrobe, tabId, onTryOn, goStyle,
}: {
  src: string; title: string; url: string; hint?: string; profile: StyleProfile | null | undefined; wardrobe: WardrobeItem[];
  tabId?: number; onTryOn?: (category: string) => void; goStyle: () => void;
}) {
  const settings = useSettings();
  const [rating, setRating] = useState<Rating | null>(cache.get(src) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const tell = (m: Omit<Extract<ToContent, { type: "rating" }>, "type" | "src">) =>
    tabId != null && chrome.tabs.sendMessage(tabId, { type: "rating", src, ...m }).catch(() => {});

  useEffect(() => {
    setErr(null);
    if (!profile || !aiReady(settings)) return;
    if (cache.has(src) && !nonce) {
      const r = cache.get(src)!;
      setRating(r);
      tell({ state: "done", score: r.score, verdict: r.verdict, headline: r.headline });
      return;
    }
    let live = true;
    setRating(null);
    tell({ state: "working" });
    (async () => {
      const image = await srcToBlob(src, 1024);
      const r = await rateItem({ image, pageTitle: title, pageUrl: url, hint, profile, wardrobe });
      cache.set(src, r);
      if (!live) return;
      setRating(r);
      tell({ state: "done", score: r.score, verdict: r.verdict, headline: r.headline });
    })().catch((e) => {
      if (!live) return;
      setErr(e.message ?? String(e));
      tell({ state: "error", headline: e.message });
    });
    return () => {
      live = false;
    };
  }, [src, profile?.createdAt, aiReady(settings), nonce]);

  if (profile === undefined || !settings) return null;

  if (!profile) {
    return (
      <section className="rate-card empty-rate">
        <Icon.face />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Get a score made for you</div>
          <div className="meta">Show Zero Q five outfits you love and it rates every item against your style.</div>
        </div>
        <button className="btn filled small" onClick={goStyle}>Set up</button>
      </section>
    );
  }

  if (!aiReady(settings)) {
    return (
      <section className="rate-card empty-rate">
        <Icon.face />
        <div className="grow"><div style={{ fontWeight: 600 }}>Add your {PROVIDER_NAME[settings.aiProvider]} key</div><div className="meta">Rating needs it. Settings, AI.</div></div>
      </section>
    );
  }

  if (err) {
    return (
      <section className="rate-card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not rate this</div>
        <p className="error" style={{ margin: "0 0 12px" }}>{err}</p>
        <button className="btn tinted small" onClick={() => setNonce((n) => n + 1)}>Try again</button>
      </section>
    );
  }

  if (!rating) {
    return (
      <section className="rate-card thinking">
        <div className="rc-top">
          <div className="rc-avatar"><Avatar a={profile.avatar} mood="think" size={80} /></div>
          <div className="grow">
            <div className="rc-row">
              <div className="ring"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" className="ring-track" /></svg></div>
              <div className="rc-verdict">Looking at it</div>
            </div>
            <div className="skeleton" style={{ width: "92%", marginTop: 12 }} />
            <div className="skeleton" style={{ width: "64%" }} />
          </div>
        </div>
      </section>
    );
  }

  return <RatingResult r={rating} profile={profile} wardrobe={wardrobe} onTryOn={onTryOn} onRedo={() => setNonce((n) => n + 1)} />;
}

const band = (s: number) => (s >= 75 ? "good" : s >= 55 ? "mid" : "low");
const barColour = (s: number) => (s >= 75 ? "var(--positive)" : s >= 55 ? "var(--text)" : "var(--negative)");

function RatingResult({ r, profile, wardrobe, onTryOn, onRedo }: { r: Rating; profile: StyleProfile; wardrobe: WardrobeItem[]; onTryOn?: (c: string) => void; onRedo: () => void }) {
  const pairs = r.wardrobe.pairsWith.map((id) => wardrobe.find((w) => w.id === id)).filter(Boolean) as WardrobeItem[];
  return (
    <section className={`rate-card ${band(r.score)}`}>
      <div className="rc-top">
        <div className="rc-avatar"><Avatar a={profile.avatar} wear={{ category: r.item.category, hex: r.item.hex }} size={80} /></div>
        <div className="grow">
          <div className="rc-row">
            <ScoreRing value={r.score} />
            <div className="rc-verdict">{r.verdict}</div>
          </div>
          <div className="rc-head">{r.headline}</div>
        </div>
      </div>

      <Receipt r={r} />

      <div className="rc-bars">
        {r.parts.filter((p) => p.key !== "wardrobe" || !pairs.length).map((p) => (
          <Bar key={p.key} label={p.label} part={{ score: p.value, note: r.notes[p.key] ?? p.why }}>
            {p.key === "colour" && <PaletteFit palette={profile.palette.best} item={r.item.hex} name={r.item.color} />}
          </Bar>
        ))}
      </div>

      {(pairs.length > 0 || r.wardrobe.note) && (
        <div className="rc-block">
          <div className="rc-label">With what you own</div>
          {pairs.length > 0 && <div className="rc-thumbs">{pairs.map((i) => <ItemImg key={i.id} item={i} />)}</div>}
          <div className="rc-note">{r.wardrobe.note}</div>
        </div>
      )}

      {r.occasions.length > 0 && (
        <div className="rc-block">
          <div className="rc-label">Wear it to</div>
          <div className="words">{r.occasions.map((o) => <span key={o}>{o}</span>)}</div>
        </div>
      )}

      {r.watchOut && <div className="rc-watch"><Icon.alert />{r.watchOut}</div>}

      <div className="rc-actions">
        {onTryOn && /top|bottom|one-piece|outerwear/.test(r.item.category) && (
          <button className="btn filled small" onClick={() => onTryOn(r.item.category)}><Icon.person /> Try it on</button>
        )}
        <button className="btn plain small" onClick={onRedo}>Rate again</button>
      </div>
    </section>
  );
}

const PART_COLOUR: Record<string, string> = { colour: "var(--accent)", style: "var(--text)", shape: "var(--muted)", wardrobe: "var(--faint)", occasion: "var(--control)" };

/** Where the points came from: one stacked bar, then any adjustment or cap that changed the total. */
function Receipt({ r }: { r: Rating }) {
  const scale = r.raw > 0 ? r.score / Math.max(r.score, r.raw) : 0;
  return (
    <div className="receipt" aria-label={`Score ${r.score}: ${r.parts.map((p) => `${p.label} ${Math.round(p.points)} points`).join(", ")}`}>
      <div className="receipt-bar">
        {r.parts.map((p) => <i key={p.key} style={{ width: `${p.points * scale}%`, background: PART_COLOUR[p.key] }} title={`${p.label}: ${Math.round(p.points)} points`} />)}
      </div>
      <div className="receipt-rows">
        {r.parts.map((p) => (
          <div key={p.key}><span><i style={{ background: PART_COLOUR[p.key] }} />{p.label}</span><b>{Math.round(p.points)}</b></div>
        ))}
        {r.adjustments.map((a) => <div key={a.reason} className="adj"><span>{a.reason}</span><b>{a.delta}</b></div>)}
        {r.caps[0] && r.raw + r.adjustments.reduce((s, a) => s + a.delta, 0) > r.caps[0].cap && (
          <div className="adj"><span>{r.caps[0].reason}, capped at</span><b>{r.caps[0].cap}</b></div>
        )}
      </div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const C = 2 * Math.PI * 26;
  const [shown, setShown] = useState(0);
  const arc = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setShown(value);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    requestAnimationFrame(() => arc.current && (arc.current.style.strokeDashoffset = String(C * (1 - value / 100))));
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div className="ring" aria-label={`Score ${value} out of 100`}>
      <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" className="ring-track" /><circle ref={arc} cx="30" cy="30" r="26" className="ring-arc" strokeDasharray={C} strokeDashoffset={C} /></svg>
      <b>{shown}</b>
    </div>
  );
}

function Bar({ label, part, children }: { label: string; part: { score: number; note: string }; children?: React.ReactNode }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setW(part.score));
    return () => cancelAnimationFrame(t);
  }, [part.score]);
  return (
    <div className="rc-bar">
      <div className="rc-bar-top"><span>{label}</span><b>{part.score}</b></div>
      <div className="track"><i style={{ transform: `scaleX(${w / 100})`, ["--bar" as any]: barColour(part.score) }} /></div>
      {children}
      <div className="rc-note">{part.note}</div>
    </div>
  );
}

/**
 * The item's colour set beside your palette: your best colours as dots, the
 * nearest one ringed when it is close, the item's own colour at the end.
 */
function PaletteFit({ palette, item, name }: { palette: Array<{ name: string; hex: string }>; item: string; name: string }) {
  if (!palette.length) return null;
  const d = palette.map((p) => deltaE(p.hex, item));
  const min = Math.min(...d);
  const near = min < 18 ? d.indexOf(min) : -1;
  return (
    <div className="pal-fit" aria-label={near >= 0 ? `${name} is close to your ${palette[near].name}` : `${name} is not in your palette`}>
      {palette.map((p, i) => <i key={p.hex + i} className={i === near ? "near" : ""} style={{ background: p.hex }} title={p.name} />)}
      <i className="item" style={{ background: item }} title={name} />
      <span>{near >= 0 ? `near your ${palette[near].name.toLowerCase()}` : "outside your palette"}</span>
    </div>
  );
}
