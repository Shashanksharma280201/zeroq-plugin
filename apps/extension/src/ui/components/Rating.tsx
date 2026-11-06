import { aiReady, PROVIDER_NAME } from "../../lib/settings.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { deltaE, isStretchPick, retrieveEvents, stretchFor, type FeedbackReason, type FeedbackVerdict, type ItemSnapshot, type WardrobeItem } from "@zq/core";
import { getMemory, listEvents, logEvent } from "../../lib/events.ts";
import { downscale, hashBlob, srcToBlob } from "../../lib/images.ts";
import { putBlob } from "../../lib/db.ts";
import type { ToContent } from "../../lib/messages.ts";
import { rateItem, scoreProfile, type Rating, type StyleProfile } from "../../lib/profile.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon, ItemImg, useMemory, useSettings } from "./kit.tsx";

const cache = new Map<string, Rating>();
export const cachedRating = (src: string) => cache.get(src);

/**
 * Rates one image for you and renders the result. Also mirrors progress to
 * the card pinned on the page, so the answer shows up where you pointed.
 */
/** What Zero Q knows about the item, for the event log. */
export interface ItemContext {
  itemKey: string;
  price?: number;
  currency?: string;
  brand?: string;
}

export function snapshotOf(r: Rating, ctx: ItemContext & { url?: string }): ItemSnapshot {
  return {
    itemKey: ctx.itemKey,
    name: r.item.name,
    category: r.item.category,
    colors: r.item.colors,
    formality: r.facts.formality,
    price: ctx.price,
    currency: ctx.currency,
    brand: ctx.brand,
    url: ctx.url,
  };
}

export function RatingPanel({
  src, title, url, hint, profile, wardrobe, tabId, onTryOn, goStyle, ctx,
}: {
  src: string; title: string; url: string; hint?: string; profile: StyleProfile | null | undefined; wardrobe: WardrobeItem[];
  tabId?: number; onTryOn?: (category: string) => void; goStyle: () => void; ctx: ItemContext;
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
      tell({ state: "done", score: r.score, verdict: r.verdict, headline: r.headline, hex: r.item.hex });
      return;
    }
    let live = true;
    setRating(null);
    tell({ state: "working" });
    (async () => {
      const [image, memory, events] = await Promise.all([srcToBlob(src, 1024), getMemory(), listEvents()]);
      const history = retrieveEvents(events, { itemKey: ctx.itemKey, brand: ctx.brand, price: ctx.price }, 8);
      const r = await rateItem({ image, pageTitle: title, pageUrl: url, hint, profile, wardrobe, price: ctx.price, memory, history });
      cache.set(src, r);
      // A small copy of the photo, so history still shows it after the shop's image link expires.
      const thumbKey = `thumb:${ctx.itemKey}`;
      const thumbHash = await downscale(image, 320).then(async (t) => (await putBlob(thumbKey, t), hashBlob(t))).catch(() => undefined);
      logEvent("item_rated", {
        ...snapshotOf(r, { ...ctx, url }),
        src,
        thumbKey: thumbHash ? thumbKey : undefined,
        thumbHash,
        score: r.score,
        verdict: r.verdict,
        parts: r.parts.map((p) => ({ key: p.key, value: p.value })),
        caps: r.caps.map((c) => c.reason),
        usedHistory: history.length,
      }, { itemKey: ctx.itemKey, brand: ctx.brand }).catch(() => {});
      if (!live) return;
      setRating(r);
      tell({ state: "done", score: r.score, verdict: r.verdict, headline: r.headline, hex: r.item.hex });
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
      <>
        <section className="cfield waiting" aria-busy="true">
          <div className="field-top">
            <div className="field-score"><span className="num pulse">00</span></div>
            <div className="field-avatar"><Avatar a={profile.avatar} mood="think" size={72} /></div>
          </div>
          <div className="field-verdict">reading the photo</div>
          <div className="skeleton" style={{ width: "88%", marginTop: 14 }} />
          <div className="skeleton" style={{ width: "60%" }} />
        </section>
      </>
    );
  }

  return <RatingResult r={rating} profile={profile} wardrobe={wardrobe} onTryOn={onTryOn} onRedo={() => setNonce((n) => n + 1)} ctx={{ ...ctx, url }} stretchOn={settings.stretchPicks} />;
}

/** The colour field's ink: dark on light colours, light on dark ones. */
export function fieldInk(hex: string): { ink: string; soft: string } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.32 ? { ink: "#141210", soft: "rgba(20,18,16,.72)" } : { ink: "#fbf8f2", soft: "rgba(251,248,242,.78)" };
}

const PART_SHORT: Record<string, string> = { colour: "colour", style: "style", shape: "shape", wardrobe: "wardrobe", occasion: "occasion" };

function RatingResult({ r, profile, wardrobe, onTryOn, onRedo, ctx, stretchOn }: { r: Rating; profile: StyleProfile; wardrobe: WardrobeItem[]; onTryOn?: (c: string) => void; onRedo: () => void; ctx: ItemContext & { url: string }; stretchOn: boolean }) {
  const memory = useMemory();
  const stretch = useMemo(() => (stretchOn && r.facts ? stretchFor(r.facts, scoreProfile(profile), r.wf, memory, r) : null), [r, memory, stretchOn]);
  const pairs = r.wardrobe.pairsWith.map((id) => wardrobe.find((w) => w.id === id)).filter(Boolean) as WardrobeItem[];
  const shown = useCountUp(r.score);
  const [flood, setFlood] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setFlood(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const hex = /^#[0-9a-f]{6}$/i.test(r.item.hex) ? r.item.hex : "#8a8580";
  const { ink, soft } = fieldInk(hex);
  const capped = r.caps[0] && r.raw + r.adjustments.reduce((s, a) => s + a.delta, 0) > r.caps[0].cap ? r.caps[0] : null;
  return (
    <>
      <section className={`cfield ${flood ? "flooded" : ""}`} style={{ "--field": hex, "--field-ink": ink, "--field-soft": soft } as any} aria-label={`Score ${r.score} out of 100, ${r.verdict}`}>
        <div className="field-top">
          <div className="field-score"><span className="num">{String(shown).padStart(2, "0")}</span><span className="of">/100</span></div>
          <div className="field-avatar"><Avatar a={profile.avatar} wear={{ category: r.item.category, hex: r.item.hex }} size={72} /></div>
        </div>
        <div className="field-verdict">{r.verdict.toLowerCase()}</div>
        <p className="field-head">{r.headline}</p>
        {r.item.color && <div className="field-caption">Read as {r.item.color.toLowerCase()}</div>}
      </section>

      {isStretchPick(stretch) && <StretchNote s={stretch} r={r} ctx={ctx} />}

      <section className="reading">
        <h2 className="caps">The reading</h2>
        {r.parts.map((p) => (
          <div className="lead" key={p.key}>
            <div className="lead-row"><span>{p.label}</span><i aria-hidden /><b>{p.value}</b></div>
            {p.key === "colour" && <PaletteFit palette={profile.palette.best} item={r.item.hex} name={r.item.color} />}
            <p className="lead-note">{r.notes[p.key] ?? p.why}</p>
          </div>
        ))}
        <p className="equation">
          <b>{r.score}</b> = {r.parts.map((p, i) => <span key={p.key}>{i > 0 && " + "}{Math.round(p.points)} {PART_SHORT[p.key]}</span>)}
          {r.adjustments.map((a) => <span key={a.reason} className="minus"> {a.delta < 0 ? "−" : "+"} {Math.abs(a.delta)} budget</span>)}
          {capped && <span className="minus">, capped at {capped.cap}: {capped.reason.toLowerCase()}</span>}
        </p>

        {(pairs.length > 0 || r.wardrobe.note) && (
          <div className="lead">
            <div className="lead-row"><span>Wear it with</span><i aria-hidden /><b>{pairs.length || ""}</b></div>
            {pairs.length > 0 && <div className="rc-thumbs">{pairs.map((i) => <ItemImg key={i.id} item={i} />)}</div>}
            {r.wardrobe.note && <p className="lead-note">{r.wardrobe.note}</p>}
          </div>
        )}
        {r.occasions.length > 0 && (
          <div className="lead">
            <div className="lead-row"><span>Wear it to</span><i aria-hidden /><b /></div>
            <p className="lead-note">{r.occasions.join(", ")}</p>
          </div>
        )}
        {r.watchOut && <p className="watch">{r.watchOut}</p>}

        <Feedback r={r} ctx={ctx} />

        <div className="rc-actions">
          {onTryOn && /top|bottom|one-piece|outerwear/.test(r.item.category) && (
            <button className="btn filled small" onClick={() => onTryOn(r.item.category)}><Icon.person /> Try it on</button>
          )}
          <button className="btn plain small" onClick={onRedo}>Rate again</button>
        </div>
      </section>
    </>
  );
}

function useCountUp(value: number): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(value);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
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

/**
 * Shown when the item breaks one of your soft limits (budget, occasion,
 * colour) but your history says you would like it anyway.
 */
function StretchNote({ s, r, ctx }: { s: NonNullable<ReturnType<typeof stretchFor>>; r: Rating; ctx: ItemContext & { url: string } }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <section className="stretch-note" aria-label="Outside your usual">
      <div className="caps">Outside your usual</div>
      <p className="stretch-score"><b>{s.score}</b> by your history, {s.base} by your rules</p>
      {s.reasons.map((x) => <p className="stretch-why" key={x.kind}>{x.label}.</p>)}
      <button className="btn plain small" onClick={() => {
        setGone(true);
        logEvent("dismissed", { ...snapshotOf(r, ctx), stretch: s.reasons[0].kind, score: s.score, list: "rating" }, { itemKey: ctx.itemKey }).catch(() => {});
      }}>Not for me</button>
    </section>
  );
}

const answered = new Map<string, FeedbackVerdict>();
const REASONS: Array<[FeedbackReason, string]> = [["colour", "Colour"], ["style", "Style"], ["shape", "Shape"], ["occasion", "Occasion"], ["price", "Price"]];

/** "Is 62 right for you?" Your answers teach the memory; nothing is re-scored on the spot. */
function Feedback({ r, ctx }: { r: Rating; ctx: ItemContext & { url: string } }) {
  const key = `${ctx.itemKey}:${r.score}`;
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(answered.get(key) ?? null);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [sent, setSent] = useState(answered.has(key));
  const send = (v: FeedbackVerdict, why: FeedbackReason[]) => {
    answered.set(key, v);
    setSent(true);
    logEvent("rating_feedback", { ...snapshotOf(r, ctx), score: r.score, verdict: v, reasons: why }, { itemKey: ctx.itemKey, brand: ctx.brand }).catch(() => {});
  };
  if (sent) {
    return <p className="feedback done" role="status">{verdict === "right" ? "Noted. Zero Q will keep scoring like this." : `Noted. Zero Q will ${verdict === "low" ? "lean higher" : "lean lower"} on pieces like this.`}</p>;
  }
  return (
    <div className="feedback">
      <div className="fb-q">Is {r.score} right for you?</div>
      <div className="fb-row" role="group" aria-label="Score feedback">
        {(["low", "right", "high"] as FeedbackVerdict[]).map((v) => (
          <button key={v} className="chip" aria-pressed={verdict === v} onClick={() => (v === "right" ? (setVerdict(v), send(v, [])) : setVerdict(v))}>
            {v === "low" ? "Too low" : v === "right" ? "About right" : "Too high"}
          </button>
        ))}
      </div>
      {verdict && verdict !== "right" && (
        <>
          <div className="fb-q small">What did it get wrong?</div>
          <div className="fb-row">
            {REASONS.map(([k, label]) => (
              <button key={k} className="chip" aria-pressed={reasons.includes(k)} onClick={() => setReasons((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}>{label}</button>
            ))}
          </div>
          <button className="btn filled small" onClick={() => send(verdict, reasons)}>Send</button>
        </>
      )}
    </div>
  );
}
