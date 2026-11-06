import { COLOR_HEX } from "./classify.ts";
import { budgetMax, deltaE, scoreItem, type ItemFacts, type PartKey, type ScoreProfile, type ScoreResult, type Swatch, type WardrobeFacts } from "./score.ts";

/**
 * Zero Q memory.
 *
 * Every action is an event in an append-only log. This file turns that log
 * into a small "taste memory" (what you actually buy, keep, open and turn
 * down), decides when an item is worth showing even though it breaks one of
 * your own limits, and picks the past events most like a new item so the AI
 * can see them.
 *
 * Pure functions only, so the same code runs in the extension and in tests.
 */

// ---------- events ----------

export type EventType =
  | "profile_built"
  | "product_viewed"
  | "item_rated"
  | "item_picked"
  | "rating_feedback"
  | "brand_scanned"
  | "suggestion_opened"
  | "dismissed"
  | "tryon_run"
  | "bought"
  | "wardrobe_added"
  | "wardrobe_updated"
  | "wardrobe_removed"
  | "outfit_suggested"
  | "outfit_worn"
  | "setting_changed"
  | "photo_set"
  | "notes_written"
  | "note_removed";

export interface ZQEvent<P = any> {
  /** ULID: unique and sortable by time */
  id: string;
  ts: string;
  type: EventType;
  payload: P;
  refs?: { itemKey?: string; brand?: string; items?: string[] };
  v: 1;
  device: string;
}

/** What most item events carry, so memory can learn from them. */
export interface ItemSnapshot {
  itemKey?: string;
  name?: string;
  category?: string;
  /** main colour first; hex when known */
  colors?: Swatch[];
  formality?: number;
  price?: number;
  currency?: string;
  brand?: string;
  url?: string;
}

export type FeedbackVerdict = "low" | "right" | "high";
export type FeedbackReason = PartKey | "price";
export type StretchKind = "budget" | "occasion" | "colour" | "gap";

// ---------- the taste memory ----------

export interface ColourMemory {
  name: string;
  hex: string;
  bought: number;
  kept: number;
  up: number;
  down: number;
  dismissed: number;
}

export interface TasteNote {
  id: string;
  text: string;
  /** event ids this note is based on */
  evidence: string[];
  at: string;
}

export interface TasteMemory {
  version: number;
  builtAt: string;
  eventCount: number;
  since?: string;
  spend: { bought: number; median: number | null; p90: number | null; max: number | null; currency?: string; prices: number[]; loved: number[] };
  colours: ColourMemory[];
  categories: Array<{ category: string; bought: number; rated: number; avgScore: number }>;
  brands: Array<{ brand: string; bought: number; rated: number; avgScore: number; scanned: number; opened: number }>;
  /** counts by dressiness 1-5, index 0 unused */
  formality: { bought: number[]; worn: number[] };
  occasions: Array<{ occasion: string; worn: number }>;
  feedback: { total: number; right: number; low: number; high: number; byReason: Record<string, number> };
  highNotBought: Array<{ itemKey: string; name: string; score: number; price?: number; brand?: string; ts: string }>;
  stretch: { opened: Record<StretchKind, number>; dismissed: Record<StretchKind, number> };
  counts: Partial<Record<EventType, number>>;
  notes: TasteNote[];
}

const zeroKinds = (): Record<StretchKind, number> => ({ budget: 0, occasion: 0, colour: 0, gap: 0 });

export function emptyMemory(): TasteMemory {
  return {
    version: 0,
    builtAt: new Date(0).toISOString(),
    eventCount: 0,
    spend: { bought: 0, median: null, p90: null, max: null, prices: [], loved: [] },
    colours: [],
    categories: [],
    brands: [],
    formality: { bought: [0, 0, 0, 0, 0, 0], worn: [0, 0, 0, 0, 0, 0] },
    occasions: [],
    feedback: { total: 0, right: 0, low: 0, high: 0, byReason: {} },
    highNotBought: [],
    stretch: { opened: zeroKinds(), dismissed: zeroKinds() },
    counts: {},
    notes: [],
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Colours from a snapshot, turning plain names ("olive") into hex where needed. */
export function snapshotColours(s: ItemSnapshot | undefined): Swatch[] {
  if (!s?.colors) return [];
  return s.colors
    .map((c: any) => (typeof c === "string" ? { name: c, hex: COLOR_HEX[c] ?? "" } : c))
    .filter((c: Swatch) => c && HEX.test(c.hex));
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Builds the taste memory from the whole log. Cheap enough to run on every
 * 20th event: a year of heavy use is ~20k events.
 */
export function buildMemory(events: ZQEvent[], prev?: TasteMemory | null): TasteMemory {
  const m = emptyMemory();
  m.version = (prev?.version ?? 0) + 1;
  m.builtAt = new Date().toISOString();
  m.eventCount = events.length;
  m.since = events[0]?.ts;

  const removedNotes = new Set<string>();
  // Notes come from the log (so they sync); older memories kept them only locally.
  let notes: TasteNote[] = prev?.notes ?? [];
  const colourAt = (hex: string, name: string): ColourMemory => {
    let c = m.colours.find((x) => deltaE(x.hex, hex) < 10);
    if (!c) m.colours.push((c = { name, hex, bought: 0, kept: 0, up: 0, down: 0, dismissed: 0 }));
    return c;
  };
  const cats = new Map<string, { bought: number; rated: number; sum: number }>();
  const cat = (k?: string) => {
    const key = k || "other";
    if (!cats.has(key)) cats.set(key, { bought: 0, rated: 0, sum: 0 });
    return cats.get(key)!;
  };
  const brands = new Map<string, { bought: number; rated: number; sum: number; scanned: number; opened: number; name: string }>();
  const brand = (b?: string) => {
    if (!b) return null;
    const key = b.trim().toLowerCase();
    if (!key) return null;
    if (!brands.has(key)) brands.set(key, { bought: 0, rated: 0, sum: 0, scanned: 0, opened: 0, name: b.trim() });
    return brands.get(key)!;
  };
  const occ = new Map<string, number>();
  const bought: number[] = [];
  const boughtKeys = new Set<string>();
  const rated = new Map<string, { name: string; score: number; price?: number; brand?: string; ts: string }>();
  const fBucket = (f?: number) => (f && f >= 1 && f <= 5 ? Math.round(f) : 0);

  for (const e of events) {
    m.counts[e.type] = (m.counts[e.type] ?? 0) + 1;
    const p = e.payload ?? {};
    const item: ItemSnapshot = p.item ?? p;
    const main = snapshotColours(item)[0];
    switch (e.type) {
      case "bought": {
        if (item.itemKey && boughtKeys.has(item.itemKey)) break;
        if (item.itemKey) boughtKeys.add(item.itemKey);
        if (item.price) bought.push(item.price);
        if (item.currency) m.spend.currency ??= item.currency;
        if (main) colourAt(main.hex, main.name).bought++;
        cat(item.category).bought++;
        const b = brand(item.brand);
        if (b) b.bought++;
        const f = fBucket(item.formality);
        if (f) m.formality.bought[f]++;
        break;
      }
      case "item_rated": {
        const score = Number(p.score);
        if (!Number.isFinite(score)) break;
        const c = cat(item.category);
        c.rated++;
        c.sum += score;
        const b = brand(item.brand);
        if (b) {
          b.rated++;
          b.sum += score;
        }
        if (item.itemKey) rated.set(item.itemKey, { name: item.name ?? "Item", score, price: item.price, brand: item.brand, ts: e.ts });
        if (score >= 80 && item.price) m.spend.loved.push(item.price);
        break;
      }
      case "rating_feedback": {
        const v = p.verdict as FeedbackVerdict;
        m.feedback.total++;
        if (v === "right") m.feedback.right++;
        else if (v === "low") m.feedback.low++;
        else if (v === "high") m.feedback.high++;
        for (const r of (p.reasons ?? []) as string[]) m.feedback.byReason[r] = (m.feedback.byReason[r] ?? 0) + 1;
        // "Too low" means you like it more than the score said; "too high", less.
        if (main) {
          const c = colourAt(main.hex, main.name);
          if (v === "low" || (v === "right" && Number(p.score) >= 75)) c.up++;
          if (v === "high" || (v === "right" && Number(p.score) < 40)) c.down++;
        }
        if (v === "low" && item.price) m.spend.loved.push(item.price);
        break;
      }
      case "tryon_run": {
        if (p.kept && main) colourAt(main.hex, main.name).kept++;
        break;
      }
      case "suggestion_opened": {
        const b = brand(item.brand);
        if (b) b.opened++;
        if (p.stretch && p.stretch in m.stretch.opened) m.stretch.opened[p.stretch as StretchKind]++;
        if (Number(p.score) >= 75 && item.price) m.spend.loved.push(item.price);
        break;
      }
      case "dismissed": {
        if (main) colourAt(main.hex, main.name).dismissed++;
        if (p.stretch && p.stretch in m.stretch.dismissed) m.stretch.dismissed[p.stretch as StretchKind]++;
        break;
      }
      case "brand_scanned": {
        const b = brand(p.brand);
        if (b) b.scanned++;
        break;
      }
      case "outfit_worn": {
        const f = fBucket(p.formality);
        if (f) m.formality.worn[f]++;
        if (p.occasion) occ.set(String(p.occasion), (occ.get(String(p.occasion)) ?? 0) + 1);
        break;
      }
      case "notes_written":
        if (Array.isArray(p.notes)) notes = p.notes as TasteNote[];
        break;
      case "note_removed":
        removedNotes.add(String(p.noteId));
        break;
    }
  }

  bought.sort((a, b) => a - b);
  m.spend.bought = bought.length;
  m.spend.median = quantile(bought, 0.5);
  m.spend.p90 = quantile(bought, 0.9);
  m.spend.max = bought.length ? bought[bought.length - 1] : null;
  m.spend.prices = bought.slice(-200);
  m.spend.loved = m.spend.loved.slice(-40);

  const strength = (c: ColourMemory) => c.bought * 2 + c.kept * 1.5 + c.up - c.down - c.dismissed;
  m.colours.sort((a, b) => strength(b) - strength(a));
  m.categories = [...cats.entries()]
    .map(([category, c]) => ({ category, bought: c.bought, rated: c.rated, avgScore: c.rated ? Math.round(c.sum / c.rated) : 0 }))
    .sort((a, b) => b.bought - a.bought || b.rated - a.rated);
  m.brands = [...brands.values()]
    .map((b) => ({ brand: b.name, bought: b.bought, rated: b.rated, avgScore: b.rated ? Math.round(b.sum / b.rated) : 0, scanned: b.scanned, opened: b.opened }))
    .sort((a, b) => b.bought * 3 + b.opened + b.rated - (a.bought * 3 + a.opened + a.rated))
    .slice(0, 20);
  m.occasions = [...occ.entries()].map(([occasion, worn]) => ({ occasion, worn })).sort((a, b) => b.worn - a.worn).slice(0, 10);
  m.highNotBought = [...rated.entries()]
    .filter(([k, r]) => r.score >= 80 && !boughtKeys.has(k))
    .map(([itemKey, r]) => ({ itemKey, ...r }))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 10);
  m.notes = notes.filter((n) => !removedNotes.has(n.id));
  return m;
}

// ---------- beyond your boundaries ----------

export const STRETCH_MIN = 75;
export const STRETCH_PER_LIST = 2;
const BONUS_PER_EVIDENCE = 4;
const BONUS_MAX = 12;
/** History can argue for an item, never call it perfect. */
const STRETCH_CEILING = 95;

export interface StretchReason {
  kind: StretchKind;
  evidence: number;
  label: string;
}

export interface Stretch {
  /** the score once your soft limits give way to what your history shows */
  score: number;
  /** the normal score */
  base: number;
  reasons: StretchReason[];
  evidence: number;
}

/**
 * Never-wear and near twins stay hard. Budget, occasion and colour limits
 * are soft: when your own history says you would like this anyway, they are
 * relaxed, the item is scored again, and an evidence bonus is added.
 * Returns null when the item breaks no soft limit or nothing supports it.
 */
export function stretchFor(
  item: ItemFacts,
  profile: ScoreProfile,
  wardrobe: WardrobeFacts,
  memory: TasteMemory | null,
  base: ScoreResult = scoreItem(item, profile, wardrobe),
): Stretch | null {
  if (item.never || base.caps.some((c) => /never|twin/i.test(c.reason))) return null;
  const relaxed: ScoreProfile = { ...profile, best: [...profile.best], avoid: [...profile.avoid], formality: { ...profile.formality, range: [...profile.formality.range] as [number, number] } };
  const reasons: StretchReason[] = [];
  // You keep turning down one kind of stretch: it needs twice the proof.
  const damp = (k: StretchKind) => (memory && memory.stretch.dismissed[k] >= 3 && memory.stretch.dismissed[k] > memory.stretch.opened[k] ? 0.5 : 1);
  const broken: StretchKind[] = [];

  // Budget
  const max = budgetMax(profile.budget);
  if (max && item.price && item.price > max) {
    broken.push("budget");
    const near = (n: number) => n >= item.price! * 0.8;
    const boughtNear = memory ? memory.spend.prices.filter(near).length : 0;
    const lovedNear = memory ? memory.spend.loved.filter(near).length : 0;
    const ev = (boughtNear * 2 + Math.min(3, lovedNear)) * damp("budget");
    if (ev > 0) {
      relaxed.budget = undefined;
      reasons.push({
        kind: "budget",
        evidence: ev,
        label: boughtNear
          ? `Over your usual ${profile.budget}, but you have bought ${boughtNear === 1 ? "a piece" : `${boughtNear} pieces`} near this price`
          : `Over your usual ${profile.budget}, but you keep choosing pieces at this price`,
      });
    }
  }

  // Colour: a go-easy colour, or one just outside your palette
  const main = item.colors.find((c) => HEX.test(c.hex));
  if (main && memory) {
    const avoidHit = profile.avoid.find((a) => deltaE(a.hex, main.hex) < 14);
    const nearBest = profile.best.length ? Math.min(...profile.best.map((b) => deltaE(b.hex, main.hex))) : 99;
    const outside = !avoidHit && nearBest > 8;
    if (avoidHit || outside) {
      broken.push("colour");
      const hist = memory.colours.filter((c) => deltaE(c.hex, main.hex) < 14);
      const raw = hist.reduce((s, c) => s + c.bought * 2 + c.kept * 1.5 + c.up - c.down - c.dismissed, 0);
      const ev = Math.max(0, raw) * damp("colour");
      const adjacent = nearBest < 20;
      if (ev > 0 && (avoidHit || adjacent || raw >= 3)) {
        relaxed.avoid = relaxed.avoid.filter((a) => deltaE(a.hex, main.hex) >= 14);
        relaxed.best.push(main);
        const times = hist.reduce((s, c) => s + c.bought + c.kept, 0);
        const name = (main.name || "this colour").toLowerCase();
        reasons.push({
          kind: "colour",
          evidence: ev,
          label: avoidHit
            ? `${cap(name)} is on your go-easy list, but you have ${times ? `bought or kept it ${times === 1 ? "once" : `${times} times`}` : "rated it up"}`
            : `${cap(name)} sits just outside your palette, and you ${times ? `have chosen it ${times === 1 ? "once" : `${times} times`}` : "rate it up"}`,
        });
      }
    }
  }

  // Occasion: dressier or more casual than you set
  const f = Math.max(1, Math.min(5, Math.round(item.formality || 3)));
  const [lo, hi] = profile.formality.range;
  if (f < lo || f > hi) {
    broken.push("occasion");
    const n = memory ? memory.formality.bought[f] * 2 + memory.formality.worn[f] : 0;
    const ev = n * damp("occasion");
    if (ev > 0) {
      relaxed.formality.range = [Math.min(lo, f), Math.max(hi, f)];
      const worn = memory!.formality.worn[f] + memory!.formality.bought[f];
      reasons.push({ kind: "occasion", evidence: ev, label: `${f > hi ? "Dressier" : "More casual"} than you set, but you have bought or worn this level ${worn === 1 ? "once" : `${worn} times`}` });
    }
  }

  // Wardrobe gap: breaks a rule with no history behind it, but completes a lot of outfits
  const unsupported = broken.filter((k) => !reasons.some((r) => r.kind === k));
  if (unsupported.length && wardrobe.pairs >= 3 && wardrobe.twin < 0.6) {
    const ev = 1 * damp("gap");
    for (const k of unsupported) {
      if (k === "budget") relaxed.budget = undefined;
      if (k === "occasion") relaxed.formality.range = [Math.min(lo, f), Math.max(hi, f)];
      if (k === "colour" && main) {
        relaxed.avoid = relaxed.avoid.filter((a) => deltaE(a.hex, main.hex) >= 14);
        relaxed.best.push(main);
      }
    }
    const rule = unsupported[0] === "budget" ? "budget" : unsupported[0] === "occasion" ? "usual dressiness" : "palette";
    reasons.push({ kind: "gap", evidence: ev, label: `Breaks your ${rule}, but goes with ${wardrobe.pairs} things you own` });
  }

  if (!reasons.length) return null;
  const evidence = reasons.reduce((s, r) => s + r.evidence, 0);
  const again = scoreItem(item, relaxed, wardrobe);
  let score = again.score + Math.min(BONUS_MAX, Math.round(BONUS_PER_EVIDENCE * evidence));
  if (again.caps.length) score = Math.min(score, again.caps[0].cap);
  score = Math.max(0, Math.min(STRETCH_CEILING, Math.round(score)));
  return { score, base: base.score, reasons, evidence: Math.round(evidence * 10) / 10 };
}

/** True when a stretch is worth showing: it breaks a limit and still scores high. */
export const isStretchPick = (s: Stretch | null): s is Stretch => !!s && s.score >= STRETCH_MIN && s.score > s.base;

// ---------- retrieval: past events like this item ----------

const STRENGTH: Partial<Record<EventType, number>> = {
  bought: 3,
  rating_feedback: 2.5,
  tryon_run: 2,
  dismissed: 1.5,
  suggestion_opened: 1,
  item_rated: 1,
};

export interface Query {
  itemKey?: string;
  brand?: string;
  category?: string;
  hex?: string;
  price?: number;
}

/** The k past events most like this item, strongest signals first. */
export function retrieveEvents(events: ZQEvent[], q: Query, k = 8): ZQEvent[] {
  const scored: Array<{ e: ZQEvent; s: number }> = [];
  const qb = q.brand?.trim().toLowerCase();
  for (const e of events) {
    const w = STRENGTH[e.type];
    if (!w) continue;
    const it: ItemSnapshot = e.payload?.item ?? e.payload ?? {};
    let sim = 0;
    if (q.itemKey && it.itemKey === q.itemKey) sim += 5;
    if (qb && it.brand && it.brand.trim().toLowerCase() === qb) sim += 3;
    if (q.category && it.category === q.category) sim += 2;
    const c = snapshotColours(it)[0];
    if (q.hex && c && deltaE(q.hex, c.hex) < 15) sim += 2;
    if (q.price && it.price && Math.abs(it.price - q.price) <= q.price * 0.3) sim += 1;
    if (sim > 0) scored.push({ e, s: sim * w });
  }
  return scored
    .sort((a, b) => b.s - a.s || b.e.ts.localeCompare(a.e.ts))
    .slice(0, k)
    .map((x) => x.e);
}

/** One plain line per event, for the AI. */
export function describeEvent(e: ZQEvent): string {
  const p = e.payload ?? {};
  const it: ItemSnapshot = p.item ?? p;
  const col = snapshotColours(it)[0]?.name;
  const what = [it.name ?? "an item", [it.category, col].filter(Boolean).join(", ")].filter(Boolean).join(" (") + (it.category || col ? ")" : "");
  const price = it.price ? ` at ${it.currency ?? ""}${it.currency ? " " : ""}${Math.round(it.price)}` : "";
  const from = it.brand ? ` from ${it.brand}` : "";
  const day = e.ts.slice(0, 10);
  switch (e.type) {
    case "bought":
      return `${day} BOUGHT ${what}${price}${from}`;
    case "rating_feedback":
      return `${day} said the score ${p.score} was ${p.verdict === "low" ? "TOO LOW" : p.verdict === "high" ? "TOO HIGH" : "about right"}${p.reasons?.length ? ` (${p.reasons.join(", ")})` : ""} for ${what}${price}`;
    case "tryon_run":
      return `${day} tried on ${what}${p.kept ? " and kept the image" : ""}`;
    case "dismissed":
      return `${day} turned down ${what}${price}${from}${p.stretch ? ` (an outside-your-usual ${p.stretch} pick)` : ""}`;
    case "suggestion_opened":
      return `${day} opened ${what}${price}${from}, scored ${p.score}`;
    case "item_rated":
      return `${day} rated ${what}${price}${from}: ${p.score}`;
    default:
      return `${day} ${e.type} ${what}`;
  }
}

/** The memory as text for the AI. Kept to roughly 2 to 4k tokens. */
export function memoryBlock(m: TasteMemory | null, statedBudget?: string): string {
  if (!m || m.eventCount === 0) return "";
  const lines: string[] = ["MY HISTORY (what I actually do. When it disagrees with my stated profile, trust the history.)"];
  const cur = m.spend.currency ? `${m.spend.currency} ` : "";
  if (m.spend.bought) {
    lines.push(`Bought ${m.spend.bought} pieces. Median ${cur}${m.spend.median}, 90th percentile ${cur}${m.spend.p90}, most ${cur}${m.spend.max}.${statedBudget ? ` My stated budget: ${statedBudget}.` : ""}`);
  }
  const chosen = m.colours.filter((c) => c.bought + c.kept + c.up > c.down + c.dismissed).slice(0, 8);
  if (chosen.length) lines.push(`Colours I choose: ${chosen.map((c) => `${c.name.toLowerCase()} ${c.hex} (bought ${c.bought}, kept ${c.kept}, rated up ${c.up})`).join("; ")}.`);
  const refused = m.colours.filter((c) => c.down + c.dismissed > c.bought + c.kept + c.up).slice(0, 5);
  if (refused.length) lines.push(`Colours I turn down: ${refused.map((c) => c.name.toLowerCase()).join(", ")}.`);
  const cats = m.categories.filter((c) => c.bought || c.rated >= 3).slice(0, 6);
  if (cats.length) lines.push(`By type: ${cats.map((c) => `${c.category} bought ${c.bought}${c.rated ? `, avg score ${c.avgScore}` : ""}`).join("; ")}.`);
  const brands = m.brands.filter((b) => b.bought || b.opened || b.rated >= 2).slice(0, 8);
  if (brands.length) lines.push(`Brands: ${brands.map((b) => `${b.brand} (bought ${b.bought}, opened ${b.opened}${b.rated ? `, avg ${b.avgScore}` : ""})`).join("; ")}.`);
  const f = (arr: number[]) => arr.map((n, i) => (i && n ? `${i}:${n}` : "")).filter(Boolean).join(" ");
  if (f(m.formality.bought) || f(m.formality.worn)) lines.push(`Dressiness 1-5, bought ${f(m.formality.bought) || "-"}, worn ${f(m.formality.worn) || "-"}.`);
  if (m.occasions.length) lines.push(`Occasions I dressed for: ${m.occasions.map((o) => `${o.occasion} ${o.worn}`).join(", ")}.`);
  if (m.feedback.total) {
    const why = Object.entries(m.feedback.byReason).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(", ");
    lines.push(`On Zero Q's scores I said: about right ${m.feedback.right}, too low ${m.feedback.low}, too high ${m.feedback.high}${why ? ` (mostly about ${why})` : ""}.`);
  }
  if (m.highNotBought.length) lines.push(`Scored high but not bought: ${m.highNotBought.slice(0, 5).map((h) => `${h.name}${h.price ? ` ${cur}${h.price}` : ""} (${h.score})`).join("; ")}.`);
  if (m.notes.length) lines.push(`Notes on my taste:\n${m.notes.map((n) => `- ${n.text}`).join("\n")}`);
  return lines.join("\n");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
