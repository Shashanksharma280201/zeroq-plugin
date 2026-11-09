import type { ToBackground, ToContent } from "./lib/messages.ts";
import { relatedImages } from "./related.ts";

/**
 * Pick mode: point at any clothing photo on any site and click to rate it.
 * Started by Alt+Shift+X or the pill's target button. Esc cancels.
 * The rating comes back as a small card pinned to the photo.
 */

const SETTLE = "cubic-bezier(.32,.72,0,1)";

let host: HTMLElement | null = null;
let root: ShadowRoot;
let active = false;
let hovered: { el: Element; src: string; alt?: string } | null = null;
let pinned: { el: Element; src: string } | null = null;

function ensureHost() {
  if (host) return;
  host = document.createElement("zeroq-pick");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>
  * { box-sizing: border-box; }
  :host { --ink: #1f201d; --muted: #5f605c; --surface: #ffffff; --line: rgba(0,0,0,.08); --track: #efefec; }
  .ring { position: fixed; border-radius: 12px; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #1f201d, 0 0 0 9999px rgba(0,0,0,.32); opacity: 0;
    transition: left .2s ${SETTLE}, top .2s ${SETTLE}, width .2s ${SETTLE}, height .2s ${SETTLE}, opacity .15s; pointer-events: none; }
  .ring.on { opacity: 1; }
  .ring span { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: #1f201d; color: #fff; font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; white-space: nowrap; }
  .hint, .card { color: var(--ink); background: var(--surface); box-shadow: 0 0 0 1px var(--line), 0 12px 32px rgba(0,0,0,.18); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; letter-spacing: -.01em; }
  .hint { position: fixed; left: 50%; top: 16px; transform: translate(-50%, -80px); display: flex; gap: 10px; align-items: center; padding: 10px 12px 10px 16px; border-radius: 999px; font-size: 14px; font-weight: 500; transition: transform .4s ${SETTLE}; }
  .hint.on { transform: translate(-50%, 0); }
  .hint kbd { font: 500 12px/1 inherit; padding: 4px 7px; border-radius: 6px; background: var(--track); }
  .card { position: fixed; width: 272px; padding: 0; overflow: hidden; border-radius: 8px; pointer-events: auto; font-size: 13px; line-height: 1.38;
    opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .35s ${SETTLE}; }
  .card.on { opacity: 1; transform: none; }
  .row { display: flex; gap: 12px; align-items: center; padding: 14px; }
  .fieldc { padding: 14px 16px 12px; background: var(--fb, #f3f1ec); color: var(--fi, #141210); }
  .big { font: 400 64px/0.85 "Instrument Serif", ui-serif, Georgia, serif; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
  .ital { font: italic 400 20px/1.1 "Instrument Serif", ui-serif, Georgia, serif; margin-top: 4px; }
  .body { padding: 12px 16px 14px; }
  .score { position: relative; width: 52px; height: 52px; flex: none; }
  .score svg { width: 52px; height: 52px; transform: rotate(-90deg); }
  .score b { position: absolute; inset: 0; display: grid; place-items: center; font: 600 17px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .score .arc { transition: stroke-dashoffset .9s cubic-bezier(.22,1,.36,1); }
  .verdict { font-weight: 600; font-size: 16px; line-height: 1.2; letter-spacing: -.02em; }
  .head { color: var(--muted); margin-top: 3px; }
  .spin { width: 52px; height: 52px; border-radius: 50%; border: 4px solid var(--track); border-top-color: var(--ink); animation: spin .9s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .x { all: unset; cursor: pointer; position: absolute; top: 8px; right: 10px; color: var(--fi, var(--muted)); font-size: 13px; padding: 4px; opacity: .7; }
  .more { all: unset; cursor: pointer; display: inline-block; margin-top: 10px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
  @media (prefers-color-scheme: dark) { :host { --ink: #ffffff; --muted: #b4b4b4; --surface: #1c1c1c; --line: rgba(255,255,255,.1); --track: #2a2a2a; } }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: .01s !important; animation-duration: 2s !important; } }
</style>
<div class="ring"><span>Rate this</span></div>
<div class="hint"><span>Click any clothing photo to rate it for you</span><kbd>Esc</kbd></div>
<div class="card" role="status" aria-live="polite"></div>`;
  document.documentElement.appendChild(host);
  addEventListener("scroll", place, { passive: true, capture: true });
  addEventListener("resize", place, { passive: true });
}

const ring = () => root.querySelector(".ring") as HTMLElement;
const hint = () => root.querySelector(".hint") as HTMLElement;
const card = () => root.querySelector(".card") as HTMLElement;

/** A hover-only photo (the back view a store fades in) that the shopper can't see right now. */
function unseen(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (Number(s.opacity) < 0.1 || s.visibility === "hidden") return true;
  }
  return false;
}

/** The clothing photo under the pointer: an <img> or a large background image. */
function candidateAt(x: number, y: number): { el: Element; src: string; alt?: string } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 90 || r.height < 90) continue;
    if (unseen(el)) continue;
    if (el instanceof HTMLImageElement && (el.currentSrc || el.src)) return { el, src: el.currentSrc || el.src, alt: el.alt };
    const pic = el.querySelector?.(":scope > picture img, :scope > img") as HTMLImageElement | null;
    if (pic && (pic.currentSrc || pic.src) && pic.getBoundingClientRect().width >= 90) return { el: pic, src: pic.currentSrc || pic.src, alt: pic.alt };
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg !== "none" ? bg.match(/url\(["']?(.*?)["']?\)/) : null;
    if (m && !m[1].startsWith("data:image/svg")) return { el, src: new URL(m[1], location.href).href };
  }
  return null;
}

function onMove(e: PointerEvent) {
  const c = candidateAt(e.clientX, e.clientY);
  hovered = c;
  const r = ring();
  if (!c) return r.classList.remove("on");
  const b = c.el.getBoundingClientRect();
  Object.assign(r.style, { left: `${b.left - 4}px`, top: `${b.top - 4}px`, width: `${b.width + 8}px`, height: `${b.height + 8}px` });
  r.classList.add("on");
}

function onClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const c = hovered ?? candidateAt(e.clientX, e.clientY);
  if (!c) return;
  stop();
  pinned = { el: c.el, src: c.src };
  showCard({ type: "rating", src: c.src, state: "working" });
  const more = relatedImages(c.src, c.el).slice(1);
  chrome.runtime.sendMessage({ type: "picked", src: c.src, alt: c.alt, title: document.title, url: location.href, more } satisfies ToBackground);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") stop();
}

const swallow = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();
};

export function startPick() {
  ensureHost();
  if (active) return;
  active = true;
  hovered = null;
  card().classList.remove("on");
  hint().classList.add("on");
  document.documentElement.style.setProperty("cursor", "crosshair", "important");
  addEventListener("pointermove", onMove, true);
  addEventListener("click", onClick, true);
  addEventListener("mousedown", swallow, true);
  addEventListener("mouseup", swallow, true);
  addEventListener("keydown", onKey, true);
}

function stop() {
  active = false;
  hint().classList.remove("on");
  ring().classList.remove("on");
  document.documentElement.style.removeProperty("cursor");
  removeEventListener("pointermove", onMove, true);
  removeEventListener("click", onClick, true);
  removeEventListener("mousedown", swallow, true);
  removeEventListener("mouseup", swallow, true);
  removeEventListener("keydown", onKey, true);
}

function place() {
  if (!pinned || !host) return;
  const c = card();
  const b = pinned.el.getBoundingClientRect();
  const w = 260;
  let left = b.right + 12;
  if (left + w > innerWidth - 8) left = Math.max(8, b.left + 12);
  let top = Math.max(8, b.top + 12);
  if (top + 140 > innerHeight) top = Math.max(8, innerHeight - 160);
  c.style.left = `${left}px`;
  c.style.top = `${top}px`;
}

const tone = (s: number) => (s >= 75 ? "#2e7d32" : s >= 55 ? "currentColor" : "#b42318");

export function showCard(m: Extract<ToContent, { type: "rating" }>) {
  ensureHost();
  // Right-click picks have no element yet: pin to the matching image if we can find it.
  if (!pinned || pinned.src !== m.src) {
    const img = Array.from(document.images).find((i) => (i.currentSrc || i.src) === m.src);
    pinned = img ? { el: img, src: m.src } : pinned;
  }
  if (!pinned) return;
  const c = card();
  const C = 2 * Math.PI * 22;
  if (m.state === "working") {
    c.innerHTML = `<div class="row"><div class="spin"></div><div><div class="verdict">Looking at it</div><div class="head">Checking colour, shape and your style.</div></div></div>`;
  } else if (m.state === "error") {
    c.innerHTML = `<div class="body"><button class="x" aria-label="Close">✕</button><div class="verdict">Couldn't rate this</div><div class="head">${esc(m.headline ?? "Open the Zero Q panel for details.")}</div></div>`;
  } else {
    const s = m.score ?? 0;
    const hex = m.hex && /^#[0-9a-f]{6}$/i.test(m.hex) ? m.hex : "#f3f1ec";
    const ink = luminance(hex) > 0.32 ? "#141210" : "#fbf8f2";
    c.innerHTML = `<div class="fieldc" style="--fb:${hex};--fi:${ink}"><button class="x" aria-label="Close">✕</button>
<div class="big"><b>0</b></div><div class="ital">${esc((m.verdict ?? "").toLowerCase())}</div></div>
<div class="body"><div class="head" style="color:inherit">${esc(m.headline ?? "")}</div><button class="more">See the reading</button></div>`;
    requestAnimationFrame(() => countUp(c.querySelector(".big b") as HTMLElement, s));
    c.querySelector(".more")!.addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-panel" } satisfies ToBackground));
  }
  c.querySelector(".x")?.addEventListener("click", () => c.classList.remove("on"));
  place();
  requestAnimationFrame(() => c.classList.add("on"));
}

function countUp(el: HTMLElement, to: number) {
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 1000);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
