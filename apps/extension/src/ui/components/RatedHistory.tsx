import { useEffect, useState } from "react";
import { listRated, onEvents, type RatedEntry } from "../../lib/events.ts";
import { money, useBlobUrl } from "./kit.tsx";

type Filter = "all" | "loved" | "skip" | "bought";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["loved", "75 and up"], ["skip", "Under 55"], ["bought", "Bought"]];
const STEP = 12;

/** Everything you have rated, newest first. Tap one to open its page again. */
export function RatedHistory() {
  const [items, setItems] = useState<RatedEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(STEP);
  useEffect(() => {
    const load = () => listRated().then(setItems);
    load();
    return onEvents((e) => e.kind === "event" && load());
  }, []);
  if (!items) return null;

  const list = items.filter((r) => (filter === "loved" ? r.score >= 75 : filter === "skip" ? r.score < 55 : filter === "bought" ? r.bought : true));
  const open = (r: RatedEntry) => {
    const url = r.url ?? r.src;
    if (url) chrome.tabs.create({ url });
  };

  return (
    <section className="rated" aria-labelledby="rated-h">
      <div className="rated-head">
        <h2 className="section" id="rated-h">Rated</h2>
        <span className="meta">{items.length} {items.length === 1 ? "item" : "items"}</span>
      </div>
      {!items.length ? (
        <p className="hint" style={{ margin: "0 4px 24px" }}>Items you rate appear here with their score. Right-click any clothing photo, or press Alt Shift X and click it.</p>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Filter rated items">
            {FILTERS.map(([k, label]) => (
              <button key={k} className="chip" aria-pressed={filter === k} onClick={() => (setFilter(k), setShown(STEP))}>{label}</button>
            ))}
          </div>
          {list.length ? (
            <div className="rated-grid">
              {list.slice(0, shown).map((r) => <Card key={r.itemKey} r={r} onOpen={() => open(r)} />)}
            </div>
          ) : (
            <p className="hint" style={{ margin: "0 4px 24px" }}>Nothing here yet.</p>
          )}
          {list.length > shown && (
            <button className="btn gray small block" style={{ marginBottom: 24 }} onClick={() => setShown((n) => n + STEP * 2)}>Show more ({list.length - shown})</button>
          )}
        </>
      )}
    </section>
  );
}

function Card({ r, onOpen }: { r: RatedEntry; onOpen: () => void }) {
  const thumb = useBlobUrl(r.thumbKey);
  const [broken, setBroken] = useState(false);
  const img = thumb ?? (!broken ? r.src : undefined);
  const host = (() => { try { return new URL(r.url ?? "").hostname.replace(/^www\./, ""); } catch { return r.brand ?? ""; } })();
  const when = new Date(r.ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <button className="shop-card rated-card" onClick={onOpen} title={r.url ?? ""}>
      <div className="img" style={r.hex ? { background: r.hex } : undefined}>
        {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
        <span className={`score-pill ${r.score >= 75 ? "good" : r.score >= 55 ? "mid" : "low"}`}>{r.score}</span>
        {r.bought && <span className="bought-tag">Bought</span>}
      </div>
      <div className="name">{r.name}</div>
      <div className="sub">{[host, r.price != null ? money(r.price, r.currency) : null, when].filter(Boolean).join(" / ")}</div>
      {r.feedback && r.feedback !== "right" && <div className="sub">You said {r.feedback === "low" ? "too low" : "too high"}</div>}
    </button>
  );
}
