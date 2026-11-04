import type { ToBackground, ToContent } from "./lib/messages.ts";

/**
 * Pick mode: point at any clothing photo on any site and click to rate it.
 * Started by Alt+Shift+X or the pill's target button. Esc cancels.
 * The rating comes back as a small card pinned to the photo.
 */

const SPRING = "linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.103, 1.085 31.2%, 1.006 39.7%, 0.991 43.6%, 0.983 46.9%, 0.988 54.5%, 1.001 68.2%, 1)";

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
  .ring { position: fixed; border-radius: 14px; box-shadow: 0 0 0 3px #5e5ce6, 0 0 0 9999px rgba(0,0,0,.28); opacity: 0; transition: left .28s ${SPRING}, top .28s ${SPRING}, width .28s ${SPRING}, height .28s ${SPRING}, opacity .2s; pointer-events: none; }
  .ring.on { opacity: 1; }
  .ring span { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); padding: 7px 14px; border-radius: 16px; background: rgba(94,92,230,.92); color: #fff; font: 600 13px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; white-space: nowrap; }
  .hint { position: fixed; left: 50%; top: 18px; transform: translate(-50%, -80px); display: flex; gap: 10px; align-items: center; padding: 10px 16px; border-radius: 22px;
    font: 500 14px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; color: #1d1d1f; letter-spacing: -.01em;
    background: rgba(250,250,252,.82); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 10px 30px rgba(0,0,0,.16);
    transition: transform .6s ${SPRING}; }
  .hint.on { transform: translate(-50%, 0); }
  .hint kbd { font: 500 12px/1 inherit; padding: 3px 6px; border-radius: 5px; background: rgba(120,120,128,.16); }
  .card { position: fixed; width: 260px; padding: 14px; border-radius: 18px; pointer-events: auto; color: #1d1d1f;
    font: 400 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; letter-spacing: -.01em;
    background: rgba(250,250,252,.86); backdrop-filter: saturate(180%) blur(24px); -webkit-backdrop-filter: saturate(180%) blur(24px); box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 16px 40px rgba(0,0,0,.2);
    opacity: 0; transform: translateY(8px) scale(.94); transform-origin: top left; transition: opacity .25s, transform .6s ${SPRING}; }
  .card.on { opacity: 1; transform: none; }
  .row { display: flex; gap: 12px; align-items: center; }
  .score { position: relative; width: 56px; height: 56px; flex: none; }
  .score svg { width: 56px; height: 56px; transform: rotate(-90deg); }
  .score b { position: absolute; inset: 0; display: grid; place-items: center; font: 700 18px/1 -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .score .arc { transition: stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1); }
  .verdict { font: 700 16px/1.15 -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; letter-spacing: -.02em; }
  .head { color: rgba(60,60,67,.7); margin-top: 3px; }
  .spin { width: 56px; height: 56px; border-radius: 50%; border: 4px solid rgba(120,120,128,.18); border-top-color: #5e5ce6; animation: spin 0.9s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .x { all: unset; cursor: pointer; position: absolute; top: 8px; right: 10px; color: rgba(60,60,67,.5); font-size: 14px; }
  .more { all: unset; cursor: pointer; display: block; margin-top: 10px; color: #5e5ce6; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .hint, .card { color: #f5f5f7; background: rgba(36,36,38,.86); box-shadow: 0 0 0 .5px rgba(255,255,255,.12), 0 16px 40px rgba(0,0,0,.5); }
    .head, .x { color: rgba(235,235,245,.6); } .more { color: #8f8cff; }
  }
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

const tone = (s: number) => (s >= 75 ? "#30b158" : s >= 55 ? "#5e5ce6" : "#ff9f0a");

export function showCard(m: Extract<ToContent, { type: "rating" }>) {
  ensureHost();
  // Right-click picks have no element yet: pin to the matching image if we can find it.
  if (!pinned || pinned.src !== m.src) {
    const img = Array.from(document.images).find((i) => (i.currentSrc || i.src) === m.src);
    pinned = img ? { el: img, src: m.src } : pinned;
  }
  if (!pinned) return;
  const c = card();
  const C = 2 * Math.PI * 24;
  if (m.state === "working") {
    c.innerHTML = `<div class="row"><div class="spin"></div><div><div class="verdict">Looking at it</div><div class="head">Checking colour, shape and your style.</div></div></div>`;
  } else if (m.state === "error") {
    c.innerHTML = `<button class="x" aria-label="Close">✕</button><div class="verdict">Could not rate this</div><div class="head">${esc(m.headline ?? "Open the Zero Q panel for details.")}</div>`;
  } else {
    const s = m.score ?? 0;
    c.innerHTML = `<button class="x" aria-label="Close">✕</button>
<div class="row"><div class="score"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="24" fill="none" stroke="rgba(120,120,128,.18)" stroke-width="5"/><circle class="arc" cx="28" cy="28" r="24" fill="none" stroke="${tone(s)}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b>0</b></div>
<div><div class="verdict" style="color:${tone(s)}">${esc(m.verdict ?? "")}</div><div class="head">${esc(m.headline ?? "")}</div></div></div>
<button class="more">See why in Zero Q</button>`;
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
