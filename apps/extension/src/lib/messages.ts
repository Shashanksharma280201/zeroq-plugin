import type { DetectedProduct, ProductCheck } from "@zq/core";

/** Content script -> background */
export type ToBackground =
  | { type: "product"; product: DetectedProduct | null }
  | { type: "open-panel" }
  | { type: "mute-site"; host: string }
  | { type: "picked"; src: string; title: string; url: string; alt?: string };

/** Background or panel -> content script */
export type ToContent =
  | { type: "detect" }
  | { type: "pick-start" }
  | { type: "rating"; src: string; state: "working" | "done" | "error"; score?: number; verdict?: string; headline?: string };

/** A picked image waiting for (or holding) a rating, kept per tab in session storage. */
export interface Pick {
  src: string;
  title: string;
  url: string;
  alt?: string;
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
