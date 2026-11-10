import { useEffect, useRef, useState } from "react";
import type { Category, WardrobeItem } from "@zq/core";
import { DISCOVERY_TTL, cachedDiscovery, discover, type Discovery, type DiscoverProgress, type Look, type SearchedPiece } from "../../lib/discover.ts";
import { readCatalog } from "../../lib/catalog.ts";
import { logEvent } from "../../lib/events.ts";
import { STORES, cachedIdeas, exploreBrand, exploreIdeas, type Idea, type Ideas, type NewPick } from "../../lib/explore.ts";
import { aiReady } from "../../lib/settings.ts";
import { ScoreDot } from "../components/Outfit.tsx";
import { Icon, ItemImg, Page, money, useBlobUrl, useHud, useSettings } from "../components/kit.tsx";

/**
 * Explore: things that are new for you on purpose, outside your budget,
 * your usual searches and your wardrobe, that still suit you.
 */
export function Explore({ origin, tabId, wardrobe }: { origin?: string; tabId?: number; wardrobe: WardrobeItem[] }) {
  return (
    <Page title="Try something new" serif subtitle="Picked from what you search and own. New for you, still you.">
      <VisitedNew wardrobe={wardrobe} tabId={tabId} />
      {origin && <BrandNew origin={origin} tabId={tabId} />}
      <IdeasList />
    </Page>
  );
}

/** The card on Searched that leads here, with a peek at the colours waiting. */
export function ExploreCard({ onOpen }: { onOpen: () => void }) {
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  useEffect(() => { cachedIdeas().then(setIdeas); }, []);
  const hexes = ideas?.ideas.map((i) => i.hex).filter(Boolean).slice(0, 5) as string[] | undefined;
  return (
    <button className="explore-card" onClick={onOpen}>
      <span className="xc-art" aria-hidden>{(hexes?.length ? hexes : ["#66703e", "#9a4f2c", "#1b6e66", "#c8a24a", "#7a2234"]).map((h, i) => <i key={i} style={{ background: h }} />)}</span>
      <span className="xc-txt"><b>Try something new</b><span>New pieces and outfits from stores you visit</span></span>
      <Icon.chevronRight />
    </button>
  );
}

function IdeasList() {
  const settings = useSettings();
  const hud = useHud();
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async (force: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      setIdeas(await exploreIdeas(force));
    } catch (e: any) {
      setErr(e?.message ?? "Could not find ideas just now.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!settings) return;
    cachedIdeas().then((c) => (c ? setIdeas(c) : aiReady(settings) ? load(false) : null));
  }, [settings == null]);

  if (settings && !aiReady(settings)) return <p className="hint">Add your AI key in Settings to get ideas.</p>;
  return (
    <section aria-labelledby="ideas-h">
      <div className="sec-head"><h2 className="section" id="ideas-h">Ideas to try</h2>
        <button className="btn plain small" onClick={() => load(true)} disabled={busy}>{busy ? "Thinking" : "New ideas"}</button></div>
      {err && <p className="error">{err}</p>}
      {!ideas && busy && <div className="idea-list">{[0, 1, 2].map((i) => <div key={i} className="idea skel" aria-hidden />)}</div>}
      {ideas && (
        <div className="idea-list">
          {ideas.ideas.map((i) => <IdeaCard key={i.id} idea={i} onOpen={(store) => {
            logEvent("suggestion_opened", { list: "explore", name: i.title, category: i.category, colors: i.hex ? [{ name: "", hex: i.hex }] : undefined, store, query: i.query, kind: i.kind }).catch(() => {});
            hud(`Searching ${store}`);
          }} />)}
        </div>
      )}
    </section>
  );
}

/**
 * New from the stores in your history, as complete outfits. Reading stores
 * takes a while, so the last result is kept for a day and shown at once.
 */
function VisitedNew({ wardrobe, tabId }: { wardrobe: WardrobeItem[]; tabId?: number }) {
  const settings = useSettings();
  const [found, setFound] = useState<Discovery | null | undefined>(undefined);
  const [prog, setProg] = useState<DiscoverProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const run = async () => {
    ac.current?.abort();
    ac.current = new AbortController();
    setErr(null);
    setProg({ stage: "reading", done: 0, total: 1 });
    try {
      setFound(await discover({ signal: ac.current.signal, onProgress: setProg, useAI: !!settings && aiReady(settings) }));
    } catch (e: any) {
      if (e?.name !== "AbortError") setErr(e?.message ?? "Could not read the stores just now.");
    } finally {
      setProg(null);
    }
  };
  useEffect(() => {
    if (!settings) return;
    cachedDiscovery().then((c) => {
      setFound(c);
      // first time, or a day old: go and look without being asked
      if (!c || Date.now() - Date.parse(c.at) > DISCOVERY_TTL) run();
    });
  }, [settings == null]);

  const line = !prog ? "" : prog.stage === "reading" ? `Reading ${prog.store ?? "your stores"} (${prog.done + 1} of ${prog.total})` : prog.stage === "choosing" ? `Looking through ${prog.total} pieces you have not seen` : prog.stage === "scoring" ? `Checking the best ${prog.total} against your style` : "Putting outfits together";
  const stores = found?.stores.filter((s) => s.ok).map((s) => s.name) ?? [];
  const open = (l: Look) => {
    logEvent("suggestion_opened", { list: "explore-visited", name: l.product.name, url: l.product.url, price: l.product.price, category: l.product.category }).catch(() => {});
    tabId != null ? chrome.tabs.update(tabId, { url: l.product.url }) : chrome.tabs.create({ url: l.product.url });
  };
  return (
    <section aria-labelledby="visited-h" className="visited">
      <div className="sec-head"><h2 className="section" id="visited-h">New at stores you visit</h2>
        {!prog && found !== undefined && <button className="btn plain small" onClick={run}>{found ? "Look again" : "Look now"}</button>}</div>
      {prog && <div className="busy-card" role="status"><i className="spin dark" /><div><b>{line}</b><p>This can take a minute or two. You can keep shopping; the result stays here.</p></div></div>}
      {err && !prog && <p className="hint">{err}</p>}
      {found && found.looks.length > 0 && (
        <>
          <div className="look-list">{found.looks.map((l) => <LookCard key={l.id} look={l} wardrobe={wardrobe} onOpen={() => open(l)} />)}</div>
          <p className="hint">From {stores.join(", ")}. None of these are pieces you have already looked at.</p>
        </>
      )}
      {found && !found.looks.length && !prog && !err && (
        <p className="hint">{stores.length ? `Nothing new at ${stores.join(", ")} completes an outfit for you yet.` : "Zero Q could not read the stores in your history. Brand sites work best; big marketplaces often block this."}</p>
      )}
    </section>
  );
}

function LookCard({ look, wardrobe, onOpen }: { look: Look; wardrobe: WardrobeItem[]; onOpen: () => void }) {
  const p = look.product;
  const own = look.wardrobe.map((id) => wardrobe.find((w) => w.id === id)).filter(Boolean) as WardrobeItem[];
  const names = [...own.map((w) => w.name), ...look.searched.map((s) => s.name)];
  return (
    <article className="look" aria-label={`${p.name} from ${look.store}, score ${look.score}. Wear it with ${names.join(", ")}.`}>
      <a className="look-main" href={p.url} onClick={(e) => { e.preventDefault(); onOpen(); }}>
        <img src={p.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" /><ScoreDot n={look.score} />
      </a>
      <div className="look-body">
        <div className="look-top"><span>{look.store}</span>{p.price != null && <b>{money(p.price, p.currency)}</b>}</div>
        <h3><a href={p.url} onClick={(e) => { e.preventDefault(); onOpen(); }}>{p.name}</a></h3>
        <p>{look.why}</p>
        <div className="look-with">
          <span>with</span>
          {own.map((w) => <span className="lw" key={w.id} title={w.name}><ItemImg item={w} /></span>)}
          {look.searched.map((sp) => <SearchedThumb key={sp.id} p={sp} />)}
        </div>
        {look.labels.length > 0 && <div className="look-tags">{look.labels.map((t) => <i key={t}>{t}</i>)}</div>}
      </div>
    </article>
  );
}

/** A piece you searched and liked, standing in an outfit. The dot marks it as not yours yet. */
function SearchedThumb({ p }: { p: SearchedPiece }) {
  const thumb = useBlobUrl(p.thumbKey);
  const src = thumb ?? p.src;
  return (
    <span className="lw searched" title={`${p.name} (you searched this)`}>
      {src ? <img src={src} alt={`${p.name}, a piece you searched`} referrerPolicy="no-referrer" /> : <i style={{ background: p.hex ?? "var(--surface-2)" }} />}
    </span>
  );
}

const KIND: Record<Idea["kind"], string> = { colour: "New colour", category: "New piece", style: "New style", budget: "Worth more", occasion: "New occasion" };

function IdeaCard({ idea, onOpen }: { idea: Idea; onOpen: (store: string) => void }) {
  return (
    <article className="idea" aria-label={`${idea.title}. ${idea.why}`}>
      <div className="idea-art" style={{ background: idea.hex ?? "var(--surface)" }} aria-hidden><Glyph c={idea.category} light={isLight(idea.hex)} /></div>
      <div className="idea-body">
        <div className="idea-top"><span className={`idea-kind k-${idea.kind}`}>{KIND[idea.kind]}</span>{idea.price && <span className="idea-price">{idea.price}</span>}</div>
        <h3>{idea.title}</h3>
        <p>{idea.why}</p>
        <div className="idea-stores">
          {STORES.map((s) => (
            <a key={s.name} className="store-chip" href={s.url(idea.query)} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(s.name)}>{s.name}</a>
          ))}
        </div>
      </div>
    </article>
  );
}

/** On a brand's own site: its products that are new for you. */
function BrandNew({ origin, tabId }: { origin: string; tabId?: number }) {
  const settings = useSettings();
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy"; line: string } | { kind: "done"; picks: NewPick[] } | { kind: "error"; msg: string }>({ kind: "idle" });
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const run = async () => {
    ac.current?.abort();
    ac.current = new AbortController();
    try {
      setState({ kind: "busy", line: `Reading ${host}` });
      const catalog = await readCatalog(origin, { tabId, signal: ac.current.signal, onProgress: (p) => setState({ kind: "busy", line: `Reading ${host}: ${p.read} pieces` }) });
      setState({ kind: "busy", line: "Finding what is new for you" });
      const picks = await exploreBrand(catalog, { useAI: !!settings && aiReady(settings), signal: ac.current.signal });
      setState({ kind: "done", picks });
    } catch (e: any) {
      if (e?.name !== "AbortError") setState({ kind: "error", msg: e?.message ?? "Could not read this site." });
    }
  };
  return (
    <section aria-labelledby="brand-new-h" style={{ marginBottom: 26 }}>
      <div className="sec-head"><h2 className="section" id="brand-new-h">New for you at {host}</h2></div>
      {state.kind === "idle" && <button className="btn filled block" onClick={run}>Look through {host}</button>}
      {state.kind === "busy" && <p className="hint busy-line"><i className="spin dark" />{state.line}</p>}
      {state.kind === "error" && <p className="error">{state.msg}</p>}
      {state.kind === "done" && (state.picks.length ? (
        <div className="new-grid">
          {state.picks.map((p) => (
            <a key={p.product.url} className="new-card" href={p.product.url} onClick={(e) => { e.preventDefault(); tabId != null ? chrome.tabs.update(tabId, { url: p.product.url }) : chrome.tabs.create({ url: p.product.url }); logEvent("suggestion_opened", { list: "explore-brand", name: p.product.name, url: p.product.url, price: p.product.price, brand: p.product.brand, score: p.score }).catch(() => {}); }}>
              <span className="new-img"><img src={p.product.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" /><ScoreDot n={p.score} /></span>
              <span className="new-tags">{p.because.map((b) => <i key={b} className={`nt nt-${b}`} title={p.labels[p.because.indexOf(b)]}>{b === "colour" ? "New colour" : b === "category" ? "Never tried" : "Above budget"}</i>)}</span>
              <span className="new-name truncate">{p.product.name}</span>
              {p.product.price != null && <span className="new-price">{money(p.product.price, p.product.currency)}</span>}
            </a>
          ))}
        </div>
      ) : <p className="hint">Nothing here is new for you and still a good fit. The ideas below look further.</p>)}
    </section>
  );
}

const isLight = (hex?: string) => {
  if (!hex) return true;
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
};

/** A simple silhouette of the kind of piece, drawn over its colour. */
function Glyph({ c, light }: { c: Category; light: boolean }) {
  const stroke = light ? "rgba(20,18,16,.55)" : "rgba(255,255,255,.75)";
  const d: Record<string, string> = {
    top: "M14 8 9 10 4 17l5 3 3-3v19h16V17l3 3 5-3-5-7-5-2c-1 3-3 5-6 5s-5-2-6-5Z",
    outerwear: "M13 7 8 9 3 18l5 3 3-4v20h8V14l1-6M27 7l5 2 5 9-5 3-3-4v20h-8V14l-1-6",
    bottom: "M11 6h18l2 32h-7l-4-23-4 23H9Z",
    "one-piece": "M15 5h10l1 7 5 26H9l5-26Z",
    footwear: "M6 26c4 0 7-3 9-7l6 2c3 1 7 3 12 4 2 0 3 2 3 4v3H6Z",
    accessory: "M12 14h16l3 22H9Z M15 14c0-4 2-7 5-7s5 3 5 7",
    other: "M14 8 9 10 4 17l5 3 3-3v19h16V17l3 3 5-3-5-7-5-2c-1 3-3 5-6 5s-5-2-6-5Z",
  };
  return <svg viewBox="0 0 40 42" width="44" height="46" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round"><path d={d[c] ?? d.other} /></svg>;
}
