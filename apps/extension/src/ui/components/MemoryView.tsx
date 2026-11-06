import { useState } from "react";
import { logEvent, rebuildMemory } from "../../lib/events.ts";
import { writeTasteNotes } from "../../lib/notes.ts";
import type { StyleProfile } from "../../lib/profile.ts";
import { aiReady } from "../../lib/settings.ts";
import { money, useHud, useMemory, useSettings } from "./kit.tsx";

/**
 * What Zero Q has learned from what you do: real spend against your stated
 * budget, the colours and brands you keep choosing, and the AI's notes,
 * each of which you can delete.
 */
export function MemoryView({ p }: { p: StyleProfile }) {
  const m = useMemory();
  const settings = useSettings();
  const hud = useHud();
  const [writing, setWriting] = useState(false);
  if (!settings) return null;

  const learned = m && (m.spend.bought || m.feedback.total || m.colours.length || m.notes.length);
  const chosen = m ? m.colours.filter((c) => c.bought + c.kept + c.up > c.down + c.dismissed).slice(0, 6) : [];
  const brands = m ? m.brands.filter((b) => b.bought || b.opened).slice(0, 3) : [];

  const write = async () => {
    setWriting(true);
    try {
      const n = await writeTasteNotes();
      hud(`${n.length} notes written`);
    } catch (e: any) {
      hud(e.message ?? "Could not write notes", "err");
    } finally {
      setWriting(false);
    }
  };

  return (
    <section className="memory" aria-labelledby="mem-h">
      <h2 className="section" id="mem-h">What Zero Q has learned</h2>
      {!learned ? (
        <p className="hint" style={{ margin: "0 4px 24px" }}>
          Zero Q learns from what you buy, try on and how you answer its scores. Tap "I bought this" on a product page, or answer "Is this score right?" under a rating, and this fills in.
        </p>
      ) : (
        <>
          <div className="glance">
            <div><b>{m!.spend.bought}</b><span>bought</span></div>
            <div><b className="truncate">{m!.spend.median != null ? money(m!.spend.median, m!.spend.currency) : "-"}</b><span>median spend</span></div>
            <div><b>{m!.feedback.total}</b><span>score answers</span></div>
          </div>

          {m!.spend.bought > 0 && (
            <p className="mem-line">
              You spend up to <b>{money(m!.spend.p90 ?? m!.spend.max ?? 0, m!.spend.currency)}</b> on most pieces{p.answers.budget ? <>; you told Zero Q <b>{p.answers.budget}</b></> : null}.
              {settings.stretchPicks ? " When the two differ, your spending wins." : ""}
            </p>
          )}

          {chosen.length > 0 && (
            <div className="mem-colours" aria-label="Colours you choose">
              {chosen.map((c) => (
                <div key={c.hex}>
                  <i style={{ background: c.hex }} />
                  <span>{c.name.toLowerCase()}</span>
                  <small>{[c.bought && `${c.bought} bought`, c.kept && `${c.kept} kept`, c.up && `${c.up} up`].filter(Boolean).join(", ")}</small>
                </div>
              ))}
            </div>
          )}

          {brands.length > 0 && (
            <p className="mem-line">You come back to {brands.map((b, i) => <span key={b.brand}>{i > 0 && (i === brands.length - 1 ? " and " : ", ")}<b>{b.brand}</b></span>)}.</p>
          )}

          <h3 className="caps mem-h3">Notes on your taste</h3>
          {m!.notes.length ? (
            <ul className="notes">
              {m!.notes.map((n) => (
                <li key={n.id}>
                  <span>{n.text}</span>
                  <button className="icon-x" aria-label={`Delete note: ${n.text}`} onClick={async () => {
                    await logEvent("note_removed", { noteId: n.id, text: n.text });
                    await rebuildMemory();
                  }}>×</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint" style={{ margin: "0 4px 12px" }}>Written once a week from your history after 10 new purchases, try-ons or answers.</p>
          )}
          {aiReady(settings) && (
            <button className="btn plain small" style={{ margin: "0 0 16px", padding: 0 }} onClick={write} disabled={writing}>{writing ? "Writing" : m!.notes.length ? "Rewrite notes now" : "Write notes now"}</button>
          )}
        </>
      )}
      <p className="group-footer" style={{ marginTop: 0 }}>
        {m?.eventCount ? `${m.eventCount.toLocaleString()} things remembered since ${new Date(m.since ?? m.builtAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. ` : ""}
        Kept in this browser{settings.driveSync ? " and your Google Drive" : ""}. Manage it in Settings.
      </p>
    </section>
  );
}
