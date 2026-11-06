import { describeEvent, memoryBlock, type TasteNote } from "@zq/core";
import { askAI, parseJson } from "./ai.ts";
import { getMeta, setMeta } from "./db.ts";
import { listEvents, logEvent, rebuildMemory, saveMemory, ulid } from "./events.ts";

/**
 * Once a week the AI reads your memory and your last 50 meaningful actions
 * and writes 5 to 10 short notes on your taste. Each note points at the
 * events it came from, so you can see why it exists and delete it.
 */

const KEY = new Set(["bought", "rating_feedback", "tryon_run", "dismissed", "suggestion_opened", "outfit_worn"]);
export const NOTES_EVERY_DAYS = 7;
const MIN_NEW = 10;

export async function notesDue(): Promise<boolean> {
  const at = await getMeta<string>("notesAt");
  const events = await listEvents();
  const fresh = events.filter((e) => KEY.has(e.type) && (!at || e.ts > at)).length;
  const old = !at || Date.now() - Date.parse(at) > NOTES_EVERY_DAYS * 864e5;
  return old && fresh >= MIN_NEW;
}

export async function writeTasteNotes(): Promise<TasteNote[]> {
  const memory = await rebuildMemory();
  const all = await listEvents();
  const key = all.filter((e) => KEY.has(e.type) && !(e.type === "tryon_run" && !e.payload?.kept)).slice(-50);
  if (key.length < 5) throw new Error("Zero Q needs a few more purchases, try-ons or score answers before it can write notes.");
  const removed = all.filter((e) => e.type === "note_removed" && e.payload?.text).map((e) => String(e.payload.text)).slice(-20);
  const text = await askAI(
    "You study one person's shopping history and write short, specific notes about their real taste for their personal stylist. Only patterns the evidence clearly shows. Plain words, no emoji, no flattery. Reply with JSON only.",
    [
      {
        type: "text",
        text: `${memoryBlock({ ...memory, notes: [] })}

RECENT ACTIONS (numbered)
${key.map((e, i) => `[${i}] ${describeEvent(e)}`).join("\n")}
${removed.length ? `\nI deleted these notes before, do not write them again:\n${removed.map((r) => `- ${r}`).join("\n")}\n` : ""}
Write 5 to 10 notes, each under 20 words, second person ("You buy...", "You turn down..."). Prefer notes where what I do differs from what I said. Each note cites at least 2 action numbers.
Return {"notes": [{"text": "...", "evidence": [numbers]}]}`,
      },
    ],
    { maxTokens: 900, json: true, temperature: 0.3 },
  );
  const raw = parseJson<any>(text);
  const list: any[] = Array.isArray(raw) ? raw : raw.notes ?? [];
  const now = new Date().toISOString();
  const notes: TasteNote[] = list
    .filter((n) => n && typeof n.text === "string" && n.text.trim())
    .slice(0, 10)
    .map((n) => ({
      id: ulid(),
      text: n.text.trim(),
      evidence: (Array.isArray(n.evidence) ? n.evidence : []).map(Number).filter((i: number) => key[i]).map((i: number) => key[i].id),
      at: now,
    }));
  // Written to the log so other browsers get the same notes.
  await logEvent("notes_written", { notes });
  await saveMemory({ ...memory, notes });
  await setMeta("notesAt", now);
  return notes;
}
