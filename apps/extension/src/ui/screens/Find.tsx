import { useEffect, useMemo, useRef, useState } from "react";
import {
  COLOR_HEX, DECISION_WORD, KIND_CHOICES, briefIsEmpty, briefLabel, briefQuery, budgetMax, decisionFor, emptyBrief, nameForHex, parseBrief,
  type Brief, type WardrobeItem,
} from "@zq/core";
import type { SearchedPiece } from "../../lib/discover.ts";
import { logEvent } from "../../lib/events.ts";
import { STORES } from "../../lib/explore.ts";
import { ExploreCard } from "./Explore.tsx";
import { cachedFind, dropOption, find, findStores, type FindProgress, type Found, type Option } from "../../lib/find.ts";
import { aiReady } from "../../lib/settings.ts";
import { DecisionMark, FactList } from "../components/Rating.tsx";
import { ScoreDot } from "../components/Outfit.tsx";
import { Icon, ItemImg, Page, money, useBlobUrl, useProfile, useSettings } from "../components/kit.tsx";

const PRICES = [500, 1000, 1500, 2500, 4000];
const FIRST_KINDS = 9;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Find it for me: say what you are looking for, get options from the stores
 * you visit, and end on one pick. The typed line and the choices below it are
 * two ways to say the same thing: typing "olive shirt under 1500" presses the
 * matching choices, and pressing choices needs no typing at all.
 */
export function Find({ origin, tabId, wardrobe, onExplore }: { origin?: string; tabId?: number; wardrobe: WardrobeItem[]; onExplore: () => void }) {
  const profile = useProfile();
  const settings = useSettings();
  const [brief, setBrief] = useState<Brief>(emptyBrief());
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found | null | undefined>(undefined);
  const [editing, setEditing] = useState(true);
  const [allKinds, setAllKinds] = useState(false);
  const [prog, setProg] = useState<FindProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stores, setStores] = useState<string[] | null>(null);
  const ac = useRef<AbortController | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => () => ac.current?.abort(), []);

  // Pick up where you left off; a first visit starts from your usual budget.
  const started = useRef(false);
  useEffect(() => {
    if (profile === undefined || started.current) return;
    started.current = true;
    cachedFind().then((f) => {
      setFound(f);
      if (f) { setBrief(f.brief); setText(f.brief.words.join(" ")); setEditing(false); return; }
      const usual = budgetMax(profile?.answers.budget);
      if (usual) setBrief((b) => ({ ...b, max: usual }));
    });
  }, [profile === undefined]);
  useEffect(() => { findStores(origin).then((s) => setStores(s.map((x) => x.name))); }, [origin]);

  // Your best colours come first in the row.
  const colours = useMemo(() => {
    const mine = [...new Set((profile?.palette.best ?? []).map((s) => nameForHex(s.hex)).filter((n) => COLOR_HEX[n]))];
    return { mine, all: [...mine, ...Object.keys(COLOR_HEX).filter((c) => !mine.includes(c))] };
  }, [profile]);

  const type = (v: string) => {
    setText(v);
    const p = parseBrief(v);
    // what the words say wins; anything they do not mention keeps the choice already made
    setBrief((b) => ({ kind: p.kind ?? b.kind, colors: p.colors.length ? p.colors : b.colors, max: p.max ?? b.max, words: p.words }));
  };
  const toggleColour = (c: string) => setBrief((b) => ({ ...b, colors: b.colors.includes(c) ? b.colors.filter((x) => x !== c) : [...b.colors, c].slice(-3) }));

  const run = async () => {
    ac.current?.abort();
    ac.current = new AbortController();
    setErr(null);
    setEditing(false);
    setProg({ stage: "reading", done: 0, total: 1 });
    top.current?.scrollIntoView({ block: "start" });
    try {
      const f = await find(brief, { origin, tabId, signal: ac.current.signal, onProgress: setProg, useAI: !!settings && aiReady(settings) });
      setFound(f);
    } catch (e: any) {
      if (e?.name !== "AbortError") { setErr(e?.message ?? "Could not read the stores just now."); setEditing(true); }
    } finally {
      setProg(null);
    }
  };

  const open = (o: Option, place: number) => {
    logEvent("suggestion_opened", { list: "find", name: o.product.name, url: o.product.url, price: o.product.price, category: o.product.category, score: o.score, place }).catch(() => {});
    tabId != null ? chrome.tabs.update(tabId, { url: o.product.url }) : chrome.tabs.create({ url: o.product.url });
  };
  const drop = async (o: Option) => {
    logEvent("dismissed", { itemKey: o.id, name: o.product.name, list: "find" }, { itemKey: o.id }).catch(() => {});
    setFound(await dropOption(o.id));
  };

  const line = !prog ? "" : prog.stage === "reading" ? `Reading ${prog.store ?? "your stores"} (${prog.done + 1} of ${prog.total})` : prog.stage === "choosing" ? `Looking through ${prog.total} pieces` : prog.stage === "scoring" ? `Checking the best ${prog.total} against your style` : "Choosing your pick";
  const priceChips = brief.max && !PRICES.includes(brief.max) ? [...PRICES, brief.max].sort((a, b) => a - b) : PRICES;
  const kinds = allKinds || (brief.kind && KIND_CHOICES.findIndex((k) => k.kind === brief.kind) >= FIRST_KINDS) ? KIND_CHOICES : KIND_CHOICES.slice(0, FIRST_KINDS);
  const pick = found?.options[0];
  const rest = found?.options.slice(1) ?? [];
  const read = found?.stores.filter((s) => s.ok).map((s) => s.name) ?? [];
  const query = briefQuery(found && !editing ? found.brief : brief);

  return (
    <Page title="Find it for me" serif subtitle="Say what you want. Zero Q looks through the stores you visit and ends on one pick.">
      <div ref={top} />
      {editing ? (
        <form className="brief" onSubmit={(e) => { e.preventDefault(); if (!briefIsEmpty(brief)) run(); }}>
          <label className="brief-say">
            <Icon.search />
            <input value={text} onChange={(e) => type(e.target.value)} placeholder="black oversized tee under 800" aria-label="What are you looking for?" autoFocus enterKeyHint="search" />
          </label>

          <fieldset>
            <legend>What</legend>
            <div className="chips wrap tight">
              {kinds.map((k) => <button type="button" key={k.kind} className="chip" aria-pressed={brief.kind === k.kind} onClick={() => setBrief((b) => ({ ...b, kind: b.kind === k.kind ? undefined : k.kind }))}>{k.label}</button>)}
              {kinds.length < KIND_CHOICES.length && <button type="button" className="chip more" onClick={() => setAllKinds(true)}>More</button>}
            </div>
          </fieldset>

          <fieldset>
            <legend>Colour{brief.colors.length > 0 && <span> {brief.colors.map(cap).join(", ")}</span>}</legend>
            <div className="sw-row">
              {colours.all.map((c) => (
                <button type="button" key={c} className={`sw ${colours.mine.includes(c) ? "mine" : ""}`} aria-pressed={brief.colors.includes(c)} aria-label={`${cap(c)}${colours.mine.includes(c) ? ", one of your colours" : ""}`} title={cap(c)} style={{ "--c": COLOR_HEX[c] } as any} onClick={() => toggleColour(c)}>
                  <Icon.tick />
                </button>
              ))}
            </div>
            {colours.mine.length > 0 && <p className="hint sw-key"><i aria-hidden />Your colours come first</p>}
          </fieldset>

          <fieldset>
            <legend>Price</legend>
            <div className="chips wrap tight">
              {priceChips.map((p) => <button type="button" key={p} className="chip" aria-pressed={brief.max === p} onClick={() => setBrief((b) => ({ ...b, max: p }))}>Under {inr(p)}</button>)}
              <button type="button" className="chip" aria-pressed={!brief.max} onClick={() => setBrief((b) => ({ ...b, max: undefined }))}>Any</button>
            </div>
          </fieldset>

          <button className="btn filled block" disabled={briefIsEmpty(brief) || stores?.length === 0}>{briefIsEmpty(brief) ? "Choose what you want" : `Find ${briefLabel(brief).toLowerCase()}`}</button>
          {err && <p className="error" role="alert">{err}</p>}
          {stores && (stores.length ? <p className="hint center">Looks in {stores.join(", ")}.</p> : (
            <div className="find-empty">
              <b>No stores to look in yet</b>
              <p>Zero Q looks in the stores you have visited. Open a brand's own store and ask about one piece, then come back. Until then you can search these:</p>
              <StoreLinks query={briefQuery(brief)} />
            </div>
          ))}
        </form>
      ) : (
        <div className="brief-done">
          <span className="bd-sw" aria-hidden>{(found?.brief ?? brief).colors.map((c) => <i key={c} style={{ background: COLOR_HEX[c] }} />)}</span>
          <b>{briefLabel(found && !prog ? found.brief : brief)}</b>
          <button className="btn plain small" onClick={() => { ac.current?.abort(); setEditing(true); }}>Change</button>
        </div>
      )}

      {prog && <div className="busy-card" role="status"><i className="spin dark" /><div><b>{line}</b><p>A first look at a store takes a minute. After that it is quick.</p></div></div>}

      {!editing && !prog && found && (
        <div aria-live="polite">
          {found.loosened && pick && (
            <p className="loosened" role="status">
              <Icon.alert />
              {found.loosened === "colour" ? `Nothing in ${found.brief.colors.join(" or ")}${found.brief.max ? ` under ${inr(found.brief.max)}` : ""}. These are the closest colours.` : `Nothing under ${inr(found.brief.max!)}. These are just over.`}
            </p>
          )}
          {pick ? (
            <>
              <PickCard o={pick} wardrobe={wardrobe} onOpen={() => open(pick, 0)} onDrop={() => drop(pick)} only={rest.length === 0} />
              {rest.length > 0 && (
                <section aria-labelledby="also-h">
                  <h2 className="section" id="also-h">Also good</h2>
                  <div className="opt-list">{rest.map((o, i) => <OptionRow key={o.id} o={o} onOpen={() => open(o, i + 1)} onDrop={() => drop(o)} />)}</div>
                </section>
              )}
              <p className="hint">{found.fitted} of {found.looked} pieces at {read.join(", ")} fit what you asked. These suit you best.</p>
            </>
          ) : (
            <div className="find-empty">
              <b>{found.looked ? "Nothing fits that yet" : "The stores could not be read"}</b>
              <p>{found.looked ? `Zero Q looked through ${found.looked} pieces at ${read.join(", ")}. Try another colour or a higher price, or search further:` : "Brand sites work best; big marketplaces often block this. You can search them yourself:"}</p>
            </div>
          )}
          {query && <section aria-labelledby="more-h" className="find-more"><h2 className="section" id="more-h">Search more stores</h2><StoreLinks query={query} /></section>}
        </div>
      )}

      <ExploreCard onOpen={onExplore} />
    </Page>
  );
}

/** The one piece to buy: the best of the options, with its reasons as pictures and the outfit it makes. */
function PickCard({ o, wardrobe, onOpen, onDrop, only }: { o: Option; wardrobe: WardrobeItem[]; onOpen: () => void; onDrop: () => void; only: boolean }) {
  const p = o.product;
  const d = decisionFor(o.score);
  const own = o.wardrobe.map((id) => wardrobe.find((w) => w.id === id)).filter(Boolean) as WardrobeItem[];
  const names = [...own.map((w) => w.name), ...o.searched.map((s) => s.name)];
  return (
    <article className={`pick ${d}`} aria-label={`Zero Q's pick: ${p.name} from ${o.store}${p.price != null ? `, ${money(p.price, p.currency)}` : ""}. Score ${o.score}, ${DECISION_WORD[d]}. ${o.why}${names.length ? ` Wear it with ${names.join(", ")}.` : ""}`}>
      <div className="pick-k"><Icon.sparkle />{d === "skip" ? "Closest match" : "Zero Q's pick"}</div>
      <div className="pick-top">
        <a className="pick-img" href={p.url} onClick={(e) => { e.preventDefault(); onOpen(); }} tabIndex={-1} aria-hidden><img src={p.images[0]} alt="" referrerPolicy="no-referrer" /></a>
        <div className="pick-say">
          <div className="pick-score" aria-hidden>{o.score}</div>
          <div className="pick-word"><DecisionMark d={d} />{DECISION_WORD[d]}</div>
          <h3>{p.name}</h3>
          <div className="pick-meta"><span>{o.store}</span>{p.price != null && <b>{money(p.price, p.currency)}</b>}{o.colour === "near" && <i>Close colour</i>}</div>
        </div>
      </div>
      {o.why && <p className="pick-why">{o.why}</p>}
      <p className="pick-src">{o.ai ? "Scored from its photo, against your photos and your wardrobe." : "An estimate from the listing text. Open it for a full check from the photo."}</p>
      <FactList facts={o.facts} />
      {names.length > 0 && (
        <div className="look-with">
          <span>Wear it with</span>
          {own.map((w) => <span className="lw" key={w.id} title={w.name}><ItemImg item={w} /></span>)}
          {o.searched.map((sp) => <SearchedThumb key={sp.id} p={sp} />)}
        </div>
      )}
      <div className="pick-acts">
        <button className="btn filled" onClick={onOpen}><Icon.bag />See it at {o.store}</button>
        <button className="btn plain small" onClick={onDrop}>{only ? "Not for me" : "Not for me, next"}</button>
      </div>
    </article>
  );
}

function OptionRow({ o, onOpen, onDrop }: { o: Option; onOpen: () => void; onDrop: () => void }) {
  const p = o.product;
  const good = o.facts.filter((f) => f.good).map((f) => f.label);
  return (
    <div className="opt">
      <a className="opt-main" href={p.url} onClick={(e) => { e.preventDefault(); onOpen(); }} aria-label={`${p.name} from ${o.store}${p.price != null ? `, ${money(p.price, p.currency)}` : ""}. Score ${o.score}, ${DECISION_WORD[decisionFor(o.score)]}.`}>
        <span className="opt-img"><img src={p.images[0]} alt="" loading="lazy" referrerPolicy="no-referrer" /><ScoreDot n={o.score} /></span>
        <span className="opt-txt">
          <b>{p.name}</b>
          <span className="opt-meta"><span>{o.store}</span>{p.price != null && <b>{money(p.price, p.currency)}</b>}{o.colour === "near" && <i>Close colour</i>}{!o.ai && <i>Estimate</i>}</span>
          {good.length > 0 && <span className="opt-facts">{good.slice(0, 2).map((g) => <i key={g}><Icon.tick />{g}</i>)}</span>}
        </span>
      </a>
      <button className="opt-x" aria-label={`Not for me: ${p.name}`} onClick={onDrop}>✕</button>
    </div>
  );
}

/** The same search on the big stores, opened in a new tab. Zero Q cannot read those from here; you can point at anything you like there. */
function StoreLinks({ query }: { query: string }) {
  if (!query) return null;
  return (
    <div className="chips wrap tight">
      {STORES.map((s) => <a key={s.name} className="chip" href={s.url(query)} target="_blank" rel="noopener noreferrer">{s.name}</a>)}
    </div>
  );
}

function SearchedThumb({ p }: { p: SearchedPiece }) {
  const thumb = useBlobUrl(p.thumbKey);
  const src = thumb ?? p.src;
  return (
    <span className="lw searched" title={`${p.name} (you searched this)`}>
      {src ? <img src={src} alt={`${p.name}, a piece you searched`} referrerPolicy="no-referrer" /> : <i style={{ background: p.hex ?? "var(--surface-2)" }} />}
    </span>
  );
}

/** The way in, at the top of Searched. Shows what you last asked for when there is something waiting. */
export function FindBar({ onOpen }: { onOpen: () => void }) {
  const [last, setLast] = useState<Found | null>(null);
  useEffect(() => { cachedFind().then(setLast); }, []);
  const n = last?.options.length ?? 0;
  return (
    <button className="find-bar" onClick={onOpen}>
      <span className="fb-ic"><Icon.search /></span>
      <span className="fb-txt"><b>What are you looking for?</b><span>{last && n ? `${briefLabel(last.brief)}: ${n} ${n === 1 ? "option" : "options"} waiting` : "A colour, a piece, a price."}</span></span>
      <Icon.chevronRight />
    </button>
  );
}
