import { aiReady, PROVIDER_NAME } from "../../lib/settings.ts";
import { useEffect, useRef, useState } from "react";
import type { WardrobeItem } from "@zq/core";
import { srcToBlob } from "../../lib/images.ts";
import type { ToContent } from "../../lib/messages.ts";
import { rateItem, type Rating, type StyleProfile } from "../../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon, ItemImg, useSettings } from "./kit.tsx";

const cache = new Map<string, Rating>();

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
            <div className="rc-verdict" style={{ color: "var(--label-2)" }}>Thinking about it</div>
            <div className="shimmer" style={{ width: "90%" }} />
            <div className="shimmer" style={{ width: "60%" }} />
          </div>
        </div>
      </section>
    );
  }

  return <RatingResult r={rating} profile={profile} wardrobe={wardrobe} onTryOn={onTryOn} onRedo={() => setNonce((n) => n + 1)} />;
}

const tone = (s: number) => (s >= 75 ? "var(--good)" : s >= 55 ? "var(--tint)" : "var(--warn)");

function RatingResult({ r, profile, wardrobe, onTryOn, onRedo }: { r: Rating; profile: StyleProfile; wardrobe: WardrobeItem[]; onTryOn?: (c: string) => void; onRedo: () => void }) {
  const pairs = r.wardrobe.pairsWith.map((id) => wardrobe.find((w) => w.id === id)).filter(Boolean) as WardrobeItem[];
  return (
    <section className="rate-card" style={{ "--c": tone(r.score) } as any}>
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

      <div className="rc-bars">
        <Bar label="Colour on you" part={r.colour} />
        <Bar label="Shape for you" part={r.shape} />
        <Bar label="Your style" part={r.style} />
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

function Bar({ label, part }: { label: string; part: { score: number; note: string } }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setW(part.score));
    return () => cancelAnimationFrame(t);
  }, [part.score]);
  return (
    <div className="rc-bar">
      <div className="rc-bar-top"><span>{label}</span><b>{part.score}</b></div>
      <div className="track"><i style={{ transform: `scaleX(${w / 100})`, background: tone(part.score) }} /></div>
      <div className="rc-note">{part.note}</div>
    </div>
  );
}
