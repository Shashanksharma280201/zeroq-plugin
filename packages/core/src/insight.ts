import { budgetMax, type ScoreResult, type WardrobeFacts } from "./score.ts";
import type { ProductDetails } from "./types.ts";

/**
 * The answer in pictures. A score becomes one of three decisions, the reasons
 * become a few facts with a tick or a cross, and what the product page says
 * (size, fabric, reviews, discount) becomes short rows under them.
 */
export type Decision = "buy" | "wait" | "skip";
export const DECISION_WORD: Record<Decision, string> = { buy: "Buy it", wait: "Sleep on it", skip: "Skip it" };

export function decisionFor(score: number): Decision {
  return score >= 75 ? "buy" : score >= 55 ? "wait" : "skip";
}

export interface Fact {
  key: "style" | "colour" | "budget" | "pairs";
  good: boolean;
  label: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Up to four facts, in a fixed order, each a yes or a no. */
export function quickFacts(r: Pick<ScoreResult, "parts" | "caps">, wf: WardrobeFacts | undefined, price?: number, budget?: string): Fact[] {
  const out: Fact[] = [];
  const part = (k: string) => r.parts.find((p) => p.key === k)?.value;
  const style = part("style"), shape = part("shape");
  const never = r.caps.some((c) => /never/i.test(c.reason));
  if (style != null) {
    const v = shape != null ? (style * 2 + shape) / 3 : style;
    out.push({ key: "style", good: v >= 60 && !never, label: never ? "On your never list" : v >= 60 ? "Your style" : "Not your style" });
  }
  const colour = part("colour");
  if (colour != null) out.push({ key: "colour", good: colour >= 60, label: colour >= 60 ? "Your colour" : "Not your colour" });
  const max = budgetMax(budget);
  if (max && price) out.push(price <= max ? { key: "budget", good: true, label: price === max ? "On budget" : `${inr(max - price)} under` } : { key: "budget", good: false, label: `${inr(price - max)} over` });
  if (wf && wf.size > 0) out.push(wf.twin >= 0.85 ? { key: "pairs", good: false, label: "You own one like it" } : { key: "pairs", good: wf.pairs > 0, label: wf.pairs > 0 ? `Goes with ${wf.pairs}` : "Goes with nothing" });
  return out;
}

/** What the AI read off the product page. */
export interface PageRead {
  fabric?: string;
  feel?: string;
  fitType?: string;
  season?: string;
  care?: string;
  /** 1-5 from fabric, construction and what buyers say */
  quality?: number;
  reviewSummary?: string;
  sizeAdvice?: string;
  valueNote?: string;
}

export interface PageFact {
  key: "size" | "fabric" | "reviews" | "price";
  tone: "good" | "warn" | "plain";
  title: string;
  text?: string;
}

export interface MySizes { top?: string; bottom?: string; shoe?: string }

/** Which of your sizes applies to this kind of piece. */
export function mySizeFor(category: string, sizes?: MySizes): string | undefined {
  if (!sizes) return undefined;
  return category === "bottom" ? sizes.bottom : category === "footwear" ? sizes.shoe : category === "accessory" || category === "other" ? undefined : sizes.top;
}

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "").replace(/^(UK|US|EU)/, "");

export function pageFacts(d: ProductDetails | undefined, page: PageRead | undefined, opts: { price?: number; mySize?: string } = {}): PageFact[] {
  const out: PageFact[] = [];
  const join = (...xs: Array<string | undefined | null | false>) => xs.filter(Boolean).map((x) => String(x).trim().replace(/\.$/, "")).join(". ");
  // size
  const sizes = d?.sizes ?? [];
  const mine = opts.mySize ? sizes.find((s) => norm(s.label) === norm(opts.mySize!)) : undefined;
  if (mine) {
    out.push({ key: "size", tone: mine.available ? "good" : "warn", title: mine.available ? `Your ${mine.label} is in stock` : `Your ${mine.label} is sold out`, text: page?.sizeAdvice });
  } else if (sizes.length || page?.sizeAdvice) {
    const gone = sizes.filter((s) => !s.available).map((s) => s.label);
    const left = sizes.filter((s) => s.available).map((s) => s.label);
    out.push({ key: "size", tone: sizes.length && !left.length ? "warn" : "plain", title: !sizes.length ? "Size" : !left.length ? "Sold out in every size" : `In stock: ${left.join(", ")}`, text: join(gone.length && left.length ? `Sold out: ${gone.join(", ")}` : "", page?.sizeAdvice) });
  }
  // fabric
  const fabric = page?.fabric ?? d?.material;
  if (fabric) {
    const season = page?.season && page.season !== "all" ? `Best in ${page.season} weather` : page?.season === "all" ? "Works all year" : "";
    const care = page?.care ?? d?.care;
    out.push({ key: "fabric", tone: page?.quality != null && page.quality <= 2 ? "warn" : "plain", title: fabric.charAt(0).toUpperCase() + fabric.slice(1), text: join(page?.feel, season, care && (/wash|clean|iron|dry/i.test(care) ? care : `Care: ${care}`)) });
  }
  // reviews
  if (d?.rating || page?.reviewSummary) {
    const n = d?.reviewCount;
    out.push({
      key: "reviews",
      tone: d?.rating ? (d.rating >= 4.2 ? "good" : d.rating < 3.5 ? "warn" : "plain") : "plain",
      title: d?.rating ? `${d.rating.toFixed(1)} out of 5${n ? ` from ${n.toLocaleString("en-IN")} buyers` : ""}` : "What buyers say",
      text: page?.reviewSummary,
    });
  }
  // price
  if (d?.discountPct && d.mrp && d.discountPct >= 5) out.push({ key: "price", tone: "good", title: `${d.discountPct}% off ${inr(d.mrp)}`, text: page?.valueNote });
  else if (page?.valueNote) out.push({ key: "price", tone: "plain", title: opts.price ? `${inr(opts.price)}` : "Price", text: page.valueNote });
  return out;
}

/** The product page as a block of plain text for the AI. Only what was found; nothing invented. */
export function detailsBlock(p: { name?: string; brand?: string; price?: number; currency?: string; description?: string; color?: string; details?: ProductDetails }): string {
  const d = p.details ?? {};
  const lines: string[] = [];
  const add = (k: string, v?: string | number | null) => v != null && v !== "" && lines.push(`${k}: ${v}`);
  add("Name", p.name);
  add("Brand", p.brand);
  add("Price", p.price ? `${p.currency ?? "INR"} ${p.price}${d.mrp ? ` (was ${d.mrp}${d.discountPct ? `, ${d.discountPct}% off` : ""})` : ""}` : undefined);
  add("Colour", p.color ?? d.colours?.join(", "));
  add("Store category", d.category);
  add("Material", d.material);
  add("Fit", d.fit);
  add("Pattern", d.pattern);
  add("Care", d.care);
  add("Sizes", d.sizes?.map((s) => `${s.label}${s.available ? "" : " (sold out)"}`).join(", "));
  add("Buyer rating", d.rating ? `${d.rating} of 5${d.reviewCount ? ` from ${d.reviewCount} ratings` : ""}` : undefined);
  for (const [k, v] of (d.specs ?? []).slice(0, 14)) if (!/^(material|fabric|fit|care|wash|pattern)/i.test(k)) add(k, v);
  if (p.description) lines.push(`Description: ${p.description.slice(0, 900)}`);
  if (d.reviews?.length) lines.push(`Buyer reviews:\n${d.reviews.map((r) => `- ${r}`).join("\n")}`);
  if (d.text) lines.push(`Page text: ${d.text}`);
  return lines.join("\n");
}
