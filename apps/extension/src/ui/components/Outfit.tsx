import type { ReactNode } from "react";
import type { WardrobeItem } from "@zq/core";
import { ItemImg } from "./kit.tsx";

/**
 * Outfits as pictures. A row reads like an equation:
 *   [the piece]  =  [bottom] [shoes] [layer]
 * so the answer to "what do I wear it with?" is visible without reading.
 */

export function scoreTone(n: number) {
  return n >= 75 ? "good" : n >= 55 ? "mid" : "low";
}

/** Small badge in the corner of a photo. */
export function ScoreDot({ n }: { n: number }) {
  return <span className={`score-dot ${scoreTone(n)}`} aria-label={`Score ${n} out of 100`}>{n}</span>;
}

export function OutfitRow({ main, pieces, label, onClick, aside, ai }: {
  /** the piece the row is about, already an <img> or a placeholder */
  main: ReactNode;
  pieces: WardrobeItem[];
  /** what a screen reader says for the whole row */
  label: string;
  onClick?: () => void;
  /** tiny line under the row: site, price, date */
  aside?: ReactNode;
  /** true when the AI chose at least one of the pieces */
  ai?: boolean;
}) {
  const body = (
    <>
      <div className="eqn">
        <div className="eqn-main">{main}</div>
        <span className="eqn-op" aria-hidden>=</span>
        <div className="eqn-pieces">
          {pieces.length ? pieces.slice(0, 3).map((p) => (
            <div className="eqn-piece" key={p.id} title={p.name}><ItemImg item={p} /></div>
          )) : <div className="eqn-empty">Add clothes to see outfits</div>}
          {ai && pieces.length > 0 && <span className="eqn-ai" aria-hidden>✦</span>}
        </div>
      </div>
      {aside && <div className="eqn-aside">{aside}</div>}
    </>
  );
  return onClick ? (
    <button className="eqn-row" onClick={onClick} aria-label={label}>{body}</button>
  ) : (
    <div className="eqn-row" role="group" aria-label={label}>{body}</div>
  );
}

/** The big version, for the detail sheet: the piece, then the outfit laid out flat. */
export function OutfitBoard({ main, pieces }: { main: ReactNode; pieces: WardrobeItem[] }) {
  return (
    <div className="board" role="img" aria-label={`Outfit: this piece with ${pieces.map((p) => p.name).join(", ") || "nothing yet"}`}>
      <div className="board-main">{main}</div>
      <div className="board-pieces">
        {pieces.map((p) => (
          <figure key={p.id}>
            <div className="board-img"><ItemImg item={p} /></div>
            <figcaption className="truncate">{p.name}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
