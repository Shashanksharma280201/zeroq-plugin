import type { ToBackground, ToContent } from "./lib/messages.ts";

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
  .card { position: fixed; width: 264px; padding: 14px; border-radius: 18px; pointer-events: auto; font-size: 13px; line-height: 1.38;
    opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .35s ${SETTLE}; }
  .card.on { opacity: 1; transform: none; }
  .row { display: flex; gap: 12px; align-items: center; }
  .score { position: relative; width: 52px; height: 52px; flex: none; }
  .score svg { width: 52px; height: 52px; transform: rotate(-90deg); }
  .score b { position: absolute; inset: 0; display: grid; place-items: center; font: 600 17px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .score .arc { transition: stroke-dashoffset .9s cubic-bezier(.22,1,.36,1); }
  .verdict { font-weight: 600; font-size: 16px; line-height: 1.2; letter-spacing: -.02em; }
  .head { color: var(--muted); margin-top: 3px; }
  .spin { width: 52px; height: 52px; border-radius: 50%; border: 4px solid var(--track); border-top-color: var(--ink); animation: spin .9s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .x { all: unset; cursor: pointer; position: absolute; top: 8px; right: 10px; color: var(--muted); font-size: 13px; padding: 4px; }
  .more { all: unset; cursor: pointer; display: inline-block; margin-top: 12px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
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

/** The clothing photo under the pointer: an <img> or a large background image. */
function candidateAt(x: number, y: number): { el: Element; src: string; alt?: string } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 90 || r.height < 90) continue;
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
  chrome.runtime.sendMessage({ type: "picked", src: c.src, alt: c.alt, title: document.title, url: location.href } satisfies ToBackground);
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
    c.innerHTML = `<button class="x" aria-label="Close">✕</button><div class="verdict">Could not rate this</div><div class="head">${esc(m.headline ?? "Open the Zero Q panel for details.")}</div>`;
  } else {
    const s = m.score ?? 0;
    c.innerHTML = `<button class="x" aria-label="Close">✕</button>
<div class="row"><div class="score"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="var(--track)" stroke-width="5"/><circle class="arc" cx="26" cy="26" r="22" fill="none" stroke="${tone(s)}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b>0</b></div>
<div><div class="verdict" style="color:${s >= 55 ? "inherit" : tone(s)}">${esc(m.verdict ?? "")}</div><div class="head">${esc(m.headline ?? "")}</div></div></div>
<button class="more">See why</button>`;
    requestAnimationFrame(() => {
      (c.querySelector(".arc") as SVGCircleElement).style.strokeDashoffset = String(C * (1 - s / 100));
      countUp(c.querySelector(".score b") as HTMLElement, s);
    });
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
