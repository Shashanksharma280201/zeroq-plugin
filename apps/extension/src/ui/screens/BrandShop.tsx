import { useEffect, useRef, useState } from "react";
import type { DetectedProduct, WardrobeItem } from "@zq/core";
import { readCatalog, type Progress } from "../../lib/catalog.ts";
import type { StyleProfile } from "../../lib/profile.ts";
import { aiReady } from "../../lib/settings.ts";
import { shopBrand, type Pick, type ShopResult } from "../../lib/shop.ts";
import { cachedRating } from "../components/Rating.tsx";
import { ZQMark, money, useSettings } from "../components/kit.tsx";
import { getMemory, itemKeyOf, logEvent } from "../../lib/events.ts";

type Phase = { kind: "reading"; p: Progress } | { kind: "scoring"; done: number; total: number } | { kind: "done"; r: ShopResult } | { kind: "error"; msg: string };

/**
 * "Find better on this brand": reads the brand's own site, ranks every
 * product for you, scores the best with photos, and groups them by what you
 * would do with them.
 */
export function BrandShop({ origin, tabId, selected, profile, wardrobe, onBack }: {
  origin: string;
  tabId?: number;
  selected: DetectedProduct | null;
  profile: StyleProfile | null | undefined;
  wardrobe: WardrobeItem[];
  onBack: () => void;
}) {
  const settings = useSettings();
  const [phase, setPhase] = useState<Phase>({ kind: "reading", p: { stage: "feed", read: 0, total: 0 } });
  const [run, setRun] = useState(0);
  const abort = useRef<AbortController>();
  const host = new URL(origin).hostname.replace(/^www\./, "");

  useEffect(() => {
    if (!settings || profile === undefined) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    (async () => {
      const catalog = await readCatalog(origin, { tabId, signal: ac.signal, fresh: run > 0, onProgress: (p) => setPhase({ kind: "reading", p }) });
      if (!catalog.products.length) throw new Error(`Couldn't find a product list on ${host}. Some sites hide theirs; try again from one of its category pages.`);
      const selectedScore = selected?.images[0] ? cachedRating(selected.images[0])?.score : undefined;
      const r = await shopBrand({
        catalog, selected, selectedScore, profile, wardrobe, useAI: !!profile && aiReady(settings), signal: ac.signal,
        memory: await getMemory(), stretchPicks: settings.stretchPicks,
        onProgress: (done, total) => setPhase({ kind: "scoring", done, total }),
      });
      setPhase({ kind: "done", r });
      logEvent("brand_scanned", { brand: r.brand, origin, read: r.read, better: r.better.length, withIt: r.withIt.length, also: r.alsoForYou.length, stretch: r.stretch.length }, { brand: r.brand }).catch(() => {});
    })().catch((e) => e?.name !== "AbortError" && setPhase({ kind: "error", msg: e?.message ?? String(e) }));
    return () => ac.abort();
  }, [origin, run, settings == null, profile === undefined]);

  const openUrl = (url: string) => (tabId != null ? chrome.tabs.update(tabId, { url }) : chrome.tabs.create({ url }));
  const open = (p: Pick, list: string) => {
    logEvent("suggestion_opened", { ...pickSnapshot(p), list, score: p.score, stretch: p.stretch?.reasons[0]?.kind }, { itemKey: itemKeyOf(p.product.url), brand: p.product.brand }).catch(() => {});
    openUrl(p.product.url);
  };
  const dismiss = (p: Pick, list: string) =>
    logEvent("dismissed", { ...pickSnapshot(p), list, score: p.score, stretch: p.stretch?.reasons[0]?.kind }, { itemKey: itemKeyOf(p.product.url), brand: p.product.brand }).catch(() => {});

  return (
    <div className="item-screen">
      <header className="item-top">
        <button className="btn plain small back-btn" onClick={onBack}>‹ Back</button>
        <span className="host truncate grow" style={{ textAlign: "center" }}>{host}</span>
        <ZQMark size={20} />
      </header>
      <div className="content">
        {phase.kind === "reading" || phase.kind === "scoring" ? (
          <Reading phase={phase} host={host} ai={!!profile && aiReady(settings)} />
        ) : phase.kind === "error" ? (
          <div className="empty">
            <h3>Couldn't read this brand</h3>
            <p>{phase.msg}</p>
            <button className="btn filled small" onClick={() => setRun((n) => n + 1)}>Try again</button>
          </div>
        ) : (
          <Results r={phase.r} selected={selected} open={open} dismiss={dismiss} onRefresh={() => setRun((n) => n + 1)} hasProfile={!!profile} />
        )}
      </div>
    </div>
  );
}

function Reading({ phase, host, ai }: { phase: Exclude<Phase, { kind: "done" | "error" }>; host: string; ai: boolean }) {
  const stage = phase.kind === "scoring" ? "scoring" : phase.p.stage;
  const order = ["feed", "pages", "scoring"];
  const at = order.indexOf(stage === "sitemap" || stage === "links" ? "pages" : stage === "done" ? "scoring" : stage);
  const steps = [
    { k: "feed", label: "Finding the product list" },
    { k: "pages", label: phase.kind === "reading" && phase.p.stage === "pages" ? `Reading products, ${phase.p.read} of ${phase.p.total}` : phase.kind === "reading" && phase.p.stage === "feed" && phase.p.read ? `Found ${phase.p.read} products` : "Reading products" },
    { k: "scoring", label: ai ? (phase.kind === "scoring" ? `Scoring the best for you, ${phase.done} of ${phase.total}` : "Scoring the best for you") : "Ranking for you" },
  ];
  return (
    <div style={{ paddingTop: 24 }} aria-live="polite">
      <h1 className="onb-title">Reading {host}</h1>
      <p className="onb-sub">Zero Q reads this brand's whole range, ranks every piece for you, then looks closely at the best ones.</p>
      <ul className="building-steps">
        {steps.map((s, i) => <li key={s.k} className={i < at ? "done" : i === at ? "now" : ""}><i />{s.label}</li>)}
      </ul>
    </div>
  );
}

type Open = (p: Pick, list: string) => void;

function pickSnapshot(p: Pick) {
  const r = p.rating;
  return {
    itemKey: itemKeyOf(p.product.url),
    name: r?.item.name ?? p.product.name,
    category: r?.item.category ?? p.product.category,
    colors: r?.item.colors ?? p.product.colors,
    formality: r?.facts.formality ?? p.product.formality,
    price: p.product.price,
    currency: p.product.currency,
    brand: p.product.brand,
    url: p.product.url,
  };
}

function Results({ r, selected, open, dismiss, onRefresh, hasProfile }: { r: ShopResult; selected: DetectedProduct | null; open: Open; dismiss: Open; onRefresh: () => void; hasProfile: boolean }) {
  const range = r.stats.priceMin != null ? `${money(r.stats.priceMin)} to ${money(r.stats.priceMax)}` : "-";
  return (
    <>
      <h1 className="large-title" style={{ marginTop: 16 }}>{r.brand}, for you</h1>
      <div className="glance">
        <div><b>{r.read}</b><span>pieces read</span></div>
        <div><b>{hasProfile ? `${r.stats.inPalette}%` : "-"}</b><span>in your colours</span></div>
        <div><b className="truncate">{r.stats.withinBudget != null ? `${r.stats.withinBudget}%` : range}</b><span>{r.stats.withinBudget != null ? "in your budget" : "price range"}</span></div>
      </div>

      {selected && <Group title="Instead of this" list="instead" picks={r.better} open={open} empty="Nothing of the same kind here suits you as well. What you picked is a good choice for this brand." />}
      {selected && <Group title="To wear with it" list="with" picks={r.withIt} open={open} empty="Nothing here pairs well with it and your wardrobe." />}
      <Group title={selected ? "Also for you" : "The best of it for you"} list="also" picks={r.alsoForYou} open={open} empty="Nothing else here fits your style well." />
      {r.stretch.length > 0 && <Stretch picks={r.stretch} open={open} dismiss={dismiss} />}
      {r.owned.length > 0 && <Group title="Skip, you own these" list="owned" picks={r.owned} open={open} muted />}

      <p className="hint" style={{ margin: "4px 4px 24px" }}>
        {r.aiScored ? "The top picks were scored from their photos. The rest are ranked from their names, colours and prices." : hasProfile ? "Ranked from names, colours and prices. Add an AI key in Settings to score the top picks from their photos." : "Ranked against your wardrobe only. Set up your style on the You tab for scores made for you."}{" "}
        <button className="btn plain small" style={{ height: "auto", padding: 0 }} onClick={onRefresh}>Read again</button>
      </p>
    </>
  );
}

/** Up to two pieces past your own limits, each saying which limit and why your history backs it. */
function Stretch({ picks, open, dismiss }: { picks: Pick[]; open: Open; dismiss: Open }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = picks.filter((p) => !hidden.includes(p.product.url));
  if (!shown.length) return null;
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 className="section">Outside your usual</h2>
      <div className="stretch-list">
        {shown.map((p) => (
          <div className="stretch-card" key={p.product.url}>
            <button className="stretch-open" onClick={() => open(p, "stretch")}>
              <img src={p.product.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" />
              <div className="grow">
                <div className="name">{p.product.name}</div>
                <div className="meta">{p.product.price != null ? money(p.product.price, p.product.currency) : ""}{p.stretch ? ` / ${p.stretch.score} by your history` : ""}</div>
                <div className="sub">{p.reason}.</div>
              </div>
            </button>
            <button className="btn plain small" onClick={() => { setHidden((h) => [...h, p.product.url]); dismiss(p, "stretch"); }}>Not for me</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Group({ title, list, picks, open, empty, muted }: { title: string; list: string; picks: Pick[]; open: Open; empty?: string; muted?: boolean }) {
  if (!picks.length && !empty) return null;
  return (
    <section style={{ marginBottom: 8 }}>
      <h2 className="section">{title}</h2>
      {picks.length ? (
        <div className="rail">
          {picks.map((p) => (
            <button key={p.product.url} className={`shop-card ${muted ? "muted" : ""}`} onClick={() => open(p, list)} title={p.reason}>
              <div className="img">
                <img src={p.product.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" />
                {!muted && <span className={`score-pill ${p.score >= 75 ? "good" : p.score >= 55 ? "mid" : "low"}`}>{p.score}</span>}
              </div>
              <div className="name">{p.product.name}</div>
              {p.product.price != null && <div className="price">{money(p.product.price, p.product.currency)}</div>}
              {p.reason && <div className="sub">{p.reason}</div>}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint" style={{ margin: "0 4px 24px" }}>{empty}</p>
      )}
    </section>
  );
}
