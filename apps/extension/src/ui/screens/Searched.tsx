import { useEffect, useMemo, useState } from "react";
import { DECISION_WORD, bestOutfit, colourNames, decisionFor, guessKind, type Category, type WardrobeItem } from "@zq/core";
import { addItem, getBlob } from "../../lib/db.ts";
import { listRated, logEvent, onEvents, type RatedEntry } from "../../lib/events.ts";
import { OutfitBoard, OutfitRow, ScoreDot, scoreTone } from "../components/Outfit.tsx";
import { Icon, Page, Sheet, money, useBlobUrl, useHud } from "../components/kit.tsx";

type Filter = "all" | "good" | "bought";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["good", "Worth buying"], ["bought", "Bought"]];

/** Everything you have asked Zero Q about, each with the best outfit from your wardrobe. */
export function Searched({ wardrobe, top }: { wardrobe: WardrobeItem[]; top?: React.ReactNode }) {
  const [items, setItems] = useState<RatedEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<RatedEntry | null>(null);
  const [shown, setShown] = useState(20);
  useEffect(() => {
    const load = () => listRated().then(setItems);
    load();
    return onEvents((e) => e.kind === "event" && load());
  }, []);

  const list = (items ?? []).filter((r) => (filter === "good" ? r.score >= 75 : filter === "bought" ? r.bought : true));
  const counts = { all: items?.length ?? 0, good: items?.filter((r) => r.score >= 75).length ?? 0, bought: items?.filter((r) => r.bought).length ?? 0 };

  return (
    <Page title="Searched" subtitle={items?.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : undefined}>
      {top}
      {items && items.length === 0 ? (
        <div className="empty-pic">
          <div className="empty-art" aria-hidden><span className="ea-item" /><span className="ea-op">=</span><span className="ea-p" /><span className="ea-p" /></div>
          <h3>Rate anything you like</h3>
          <p>Right-click a clothing photo on any store, or press <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>X</kbd>. It lands here with an outfit.</p>
        </div>
      ) : items ? (
        <>
          <div className="chips" role="group" aria-label="Filter">
            {FILTERS.map(([k, label]) => (
              <button key={k} className="chip" aria-pressed={filter === k} onClick={() => (setFilter(k), setShown(20))}>{label} <span className="chip-n">{counts[k]}</span></button>
            ))}
          </div>
          <div className="eqn-list">
            {list.slice(0, shown).map((r) => <SearchedRow key={r.itemKey} r={r} wardrobe={wardrobe} onOpen={() => setOpen(r)} />)}
          </div>
          {list.length > shown && <button className="btn gray small block" onClick={() => setShown((n) => n + 30)}>Show {Math.min(30, list.length - shown)} more</button>}
        </>
      ) : null}
      <SearchedSheet r={open} wardrobe={wardrobe} onClose={() => setOpen(null)} />
    </Page>
  );
}

function outfitFor(r: RatedEntry, wardrobe: WardrobeItem[]) {
  const category = (r.category as Category) || guessKind(r.name).category;
  return bestOutfit({ name: r.name, category, colors: colourNames(r.colors), formality: r.formality ?? 3 }, wardrobe, r.pairs);
}

function Photo({ r, big }: { r: RatedEntry; big?: boolean }) {
  const thumb = useBlobUrl(r.thumbKey);
  const [broken, setBroken] = useState(false);
  const src = thumb ?? (!broken ? r.src : undefined);
  return (
    <div className={`ph-wrap ${big ? "big" : ""}`} style={r.hex ? { background: r.hex } : undefined}>
      {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
      <ScoreDot n={r.score} />
      {r.bought && <span className="bought-dot" aria-label="Bought"><Icon.check /></span>}
    </div>
  );
}

const host = (u?: string) => { try { return new URL(u ?? "").hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; } };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function SearchedRow({ r, wardrobe, onOpen }: { r: RatedEntry; wardrobe: WardrobeItem[]; onOpen: () => void }) {
  const o = useMemo(() => outfitFor(r, wardrobe), [r, wardrobe]);
  return (
    <OutfitRow
      main={<Photo r={r} />}
      pieces={o.pieces}
      ai={o.fromAI.length > 0}
      onClick={onOpen}
      label={`${r.name}, score ${r.score}${r.bought ? ", bought" : ""}. Wear with ${o.pieces.map((p) => p.name).join(", ") || "nothing yet"}.`}
      aside={<><b>{r.brand || host(r.url)}</b>{r.price != null && <span>{money(r.price, r.currency)}</span>}<span>{day(r.ts)}</span></>}
    />
  );
}

function SearchedSheet({ r, wardrobe, onClose }: { r: RatedEntry | null; wardrobe: WardrobeItem[]; onClose: () => void }) {
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  const o = useMemo(() => (r ? outfitFor(r, wardrobe) : null), [r, wardrobe]);
  if (!r) return <Sheet open={false} onClose={onClose}><div /></Sheet>;

  const bought = async () => {
    setBusy(true);
    try {
      const thumb = r.thumbKey ? await getBlob(r.thumbKey) : undefined;
      const imageSrc = r.src ?? (thumb ? URL.createObjectURL(thumb) : undefined);
      const category = (r.category as Category) || guessKind(r.name).category;
      await logEvent("bought", { itemKey: r.itemKey, name: r.name, category, colors: r.colors, formality: r.formality, price: r.price, currency: r.currency, brand: r.brand, url: r.url }, { itemKey: r.itemKey, brand: r.brand });
      await addItem({ name: r.name, category, colors: colourNames(r.colors), formality: r.formality ?? 3, brand: r.brand, price: r.price, currency: r.currency, sourceUrl: r.url, imageSrc, source: "product-page" } as any);
      hud("Added to your wardrobe");
      onClose();
    } catch (e: any) {
      hud(e?.message ?? "Could not add it", "err");
    } finally {
      setBusy(false);
    }
  };
  const hide = async () => {
    await logEvent("dismissed", { itemKey: r.itemKey, name: r.name, list: "searched" }, { itemKey: r.itemKey });
    onClose();
  };

  return (
    <Sheet open={!!r} onClose={onClose} title={r.name}>
      <div className="detail">
        <div className={`detail-score ${scoreTone(r.score)}`}><b>{r.score}</b><span>{DECISION_WORD[decisionFor(r.score)]}</span></div>
        <OutfitBoard main={<Photo r={r} big />} pieces={o?.pieces ?? []} />
        {o && o.fromAI.length > 0 && <p className="hint center">✦ chosen by your stylist</p>}
        <div className="detail-meta">
          {r.brand && <span className="chip">{r.brand}</span>}
          {r.price != null && <span className="chip">{money(r.price, r.currency)}</span>}
          {r.feedback && r.feedback !== "right" && <span className="chip">You said {r.feedback === "low" ? "too low" : "too high"}</span>}
          <span className="chip">{day(r.ts)}</span>
        </div>
        <div className="detail-actions">
          {r.url && <button className="btn gray" onClick={() => chrome.tabs.create({ url: r.url! })}>Open</button>}
          {!r.bought && <button className="btn filled" disabled={busy} onClick={bought}><Icon.bag /> {busy ? "Adding" : "I bought it"}</button>}
        </div>
        <button className="btn plain small block" onClick={hide}>Remove from Searched</button>
      </div>
    </Sheet>
  );
}
