import type { DetectedProduct, ProductCheck } from "@zq/core";

/** Content script -> background */
export type ToBackground =
  | { type: "product"; product: DetectedProduct | null }
  | { type: "open-panel" }
  | { type: "mute-site"; host: string }
  | { type: "sync-now" }
  | { type: "picked"; src: string; title: string; url: string; alt?: string; more?: string[] }
  // collecting photos of you from any page
  | { type: "collect-start"; url: string; room: number }
  | { type: "collect-state" }
  | { type: "collect-add"; src: string; rect?: Rect }
  | { type: "collect-remove"; id: string }
  | { type: "collect-done" }
  | { type: "inbox-take" };

/** Where a photo sits in the page's viewport, for the screenshot fallback. */
export interface Rect { x: number; y: number; w: number; h: number; dpr: number }

/** What collect mode looks like right now. */
export interface CollectState {
  on: boolean;
  /** how many more photos Zero Q can take */
  room: number;
  /** how many were added in this round */
  taken: number;
  returnTab?: number;
  openedTab?: number;
}

/** Background or panel -> content script */
export type ToContent =
  | { type: "detect" }
  | { type: "pick-start" }
  | { type: "related"; src: string }
  | { type: "links" }
  | { type: "collect"; state: CollectState }
  | { type: "collect-veil"; on: boolean }
  | { type: "collect-flash"; ok: boolean }
  | { type: "rating"; src: string; state: "working" | "done" | "error"; score?: number; verdict?: string; headline?: string; hex?: string };

/** A picked image waiting for (or holding) a rating, kept per tab in session storage. */
export interface Pick {
  src: string;
  title: string;
  url: string;
  alt?: string;
  /** other photos of the same product: back, side, worn */
  more?: string[];
  at: number;
}

/** Short summary the content script shows on its pill. */
export interface PillSummary {
  label: string;
  tone: "good" | "warn" | "neutral";
}

export interface TabState {
  product: DetectedProduct | null;
  check: ProductCheck | null;
}

export function summarise(check: ProductCheck | null, wardrobeSize: number): PillSummary {
  if (!check) return { label: "Zero Q", tone: "neutral" };
  if (wardrobeSize === 0) return { label: "Start your wardrobe", tone: "neutral" };
  if (check.duplicates.length) {
    const n = check.duplicates.length;
    return { label: `You own ${n === 1 ? "something" : n} like this`, tone: "warn" };
  }
  if (check.pairs.length) {
    return { label: `Goes with ${check.pairs.length} of yours`, tone: "good" };
  }
  return { label: "Nothing to pair yet", tone: "neutral" };
}
