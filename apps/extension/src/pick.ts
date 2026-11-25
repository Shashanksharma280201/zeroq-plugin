import type { ToBackground, ToContent } from "./lib/messages.ts";
import { PAGE_TOKENS, onPanel, pageFont, panelOpen } from "./onpage.ts";
import { relatedImages } from "./related.ts";

/**
 * Pick mode: point at any clothing photo on any site and click to rate it.
 * Started by Alt+Shift+X or the pill's target button. Esc cancels.
 *
 * The answer comes back as a small tag that sits on the photo it belongs to.
 * It moves with that photo and leaves the screen when the photo does, so it
 * never covers anything else on the page. While the side panel is open the tag
 * stays away: the full answer is already showing there.
 */

let host: HTMLElement | null = null;
let root: ShadowRoot;
let active = false;
let hovered: { el: Element; src: string; alt?: string } | null = null;
let pinned: { el: Element; src: string } | null = null;
type RatingMsg = Extract<ToContent, { type: "rating" }>;
let last: RatingMsg | null = null;
/** the tag was closed by hand for this photo */
let closedFor = "";
let opened = false;
let foldTimer: ReturnType<typeof setTimeout> | undefined;

function ensureHost() {
  if (host) return;
  pageFont();
  host = document.createElement("zeroq-pick");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>${PAGE_TOKENS}
  * { box-sizing: border-box; }
  .ring { position: fixed; border-radius: 22px; box-shadow: 0 0 0 3px var(--milk), 0 0 0 5px var(--ink), 0 0 0 9999px rgba(42,41,39,.34); opacity: 0;
    transition: left .25s var(--settle), top .25s var(--settle), width .25s var(--settle), height .25s var(--settle), opacity .15s; pointer-events: none; }
  .ring.on { opacity: 1; }
  .ring span { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); height: 34px; padding: 0 16px; border-radius: 17px; display: grid; place-items: center; background: var(--ink); color: var(--milk); font: 600 14px/1 var(--f); white-space: nowrap; }
  .hint { position: fixed; left: 50%; top: 16px; transform: translate(-50%, -90px); display: flex; gap: 10px; align-items: center; height: 46px; padding: 0 10px 0 18px; border-radius: 23px;
    color: var(--ink); background: var(--milk); box-shadow: var(--lift); font: 500 14px/1 var(--f); transition: transform .45s var(--settle); }
  .hint.on { transform: translate(-50%, 0); }
  .hint kbd { font: 600 12px/1 var(--f); padding: 6px 9px; border-radius: 10px; background: var(--stone); }

  .tag { position: fixed; left: 0; top: 0; display: grid; justify-items: start; gap: 6px; color: var(--ink); pointer-events: none; opacity: 0; transform: scale(.7); transform-origin: 0 0;
    transition: opacity .2s, transform .45s var(--spring); }
  .tag.on { opacity: 1; transform: none; }
  .tag.on > * { pointer-events: auto; }
  button { all: unset; cursor: pointer; -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  .chip { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 12px; border-radius: 20px; background: var(--milk); color: var(--ink); box-shadow: var(--lift);
    font: 600 14px/1 var(--f); letter-spacing: -.01em; white-space: nowrap; transition: transform .15s ease-out; }
  .chip:active { transform: scale(.96); }
  .chip b { font: 600 21px/1 var(--f); letter-spacing: -.04em; font-variant-numeric: tabular-nums; min-width: 1.2em; text-align: center; }
  .chip.buy { background: var(--sage); color: var(--sage-ink); }
  .chip.wait { background: var(--butter); color: var(--butter-ink); }
  .chip.skip { background: var(--blush); color: var(--blush-ink); }
  .chip:focus-visible, .more button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--stone); border-top-color: var(--ink); animation: spin .9s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .more { width: 248px; padding: 14px 16px 14px; border-radius: 20px; background: var(--milk); box-shadow: var(--lift); font: 400 14px/1.4 var(--f);
    display: none; }
  .tag.open .more { display: block; animation: drop .3s var(--settle) both; }
  @keyframes drop { from { opacity: 0; transform: translateY(-6px); } }
  .more p { margin: 0 0 12px; }
  .acts { display: flex; gap: 6px; }
  .more button { height: 36px; padding: 0 14px; border-radius: 18px; font: 600 13px/1 var(--f); background: var(--stone); color: var(--ink); }
  .more .go { background: var(--ink); color: var(--milk); }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: .01s !important; animation-duration: .01s !important; } .spin { animation-duration: 2s !important; } }
</style>
<div class="ring"><span>Rate this</span></div>
<div class="hint"><span>Click any clothing photo to rate it for you</span><kbd>Esc</kbd></div>
<div class="tag" role="status" aria-live="polite"></div>`;
  document.documentElement.appendChild(host);
  addEventListener("scroll", place, { passive: true, capture: true });
  addEventListener("resize", place, { passive: true });
  // photos also move without a scroll (carousels, pages that load late)
  setInterval(() => { if (last && !panelOpen()) place(); }, 600);
  onPanel(() => render());
}

const ring = () => root.querySelector(".ring") as HTMLElement;
const hint = () => root.querySelector(".hint") as HTMLElement;
const tag = () => root.querySelector(".tag") as HTMLElement;

/** A hover-only photo (the back view a store fades in) that the shopper can't see right now. */
function unseen(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (Number(s.opacity) < 0.1 || s.visibility === "hidden") return true;
  }
  return false;
}

/** The clothing photo under the pointer: an <img> or a large background image. */
export function candidateAt(x: number, y: number): { el: Element; src: string; alt?: string } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host || el.tagName.startsWith("ZEROQ-")) continue;
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
  tag().classList.remove("on");
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

/**
 * Keeps the tag on its photo: tucked into the photo's top left corner, sliding
 * down with the part of the photo still on screen, and gone once the photo is.
 */
function place() {
  if (!host || !pinned) return;
  const t = tag();
  const show = !!last && !panelOpen() && closedFor !== pinned.src;
  const b = pinned.el.getBoundingClientRect();
  const onScreen = pinned.el.isConnected && b.width > 40 && b.bottom > 64 && b.top < innerHeight - 64 && b.right > 64 && b.left < innerWidth - 64;
  if (!show || !onScreen) {
    t.classList.remove("on");
    return;
  }
  const left = Math.min(Math.max(b.left + 10, 8), Math.max(8, b.right - 60));
  const top = Math.min(Math.max(b.top + 10, 8), b.bottom - 50);
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
  t.classList.add("on");
}

const decision = (s: number) => (s >= 75 ? "buy" : s >= 55 ? "wait" : "skip");
const WORD = { buy: "Buy it", wait: "Sleep on it", skip: "Skip it" } as const;

/** Draws the tag for the latest answer. Nothing shows while the side panel is open. */
function render() {
  if (!host) return;
  const t = tag();
  const m = last;
  if (!m || !pinned) return t.classList.remove("on");
  if (m.state === "working") {
    t.innerHTML = `<div class="chip"><i class="spin"></i>Looking at it</div>`;
  } else if (m.state === "error") {
    t.innerHTML = `<button class="chip" aria-expanded="${opened}">Couldn't rate this</button>
<div class="more"><p>${esc(m.headline ?? "Open Zero Q for details.")}</p><div class="acts"><button class="go">Open Zero Q</button><button class="hide">Hide</button></div></div>`;
  } else {
    const s = m.score ?? 0, d = decision(s);
    t.innerHTML = `<button class="chip ${d}" aria-expanded="${opened}" aria-label="Zero Q score ${s}, ${WORD[d]}. Show why."><b>${s}</b>${WORD[d]}</button>
<div class="more"><p>${esc(m.headline ?? "")}</p><div class="acts"><button class="go">See the full answer</button><button class="hide">Hide</button></div></div>`;
  }
  t.classList.toggle("open", opened && m.state !== "working");
  t.querySelector("button.chip")?.addEventListener("click", () => {
    opened = !opened;
    clearTimeout(foldTimer);
    t.classList.toggle("open", opened);
    t.querySelector(".chip")?.setAttribute("aria-expanded", String(opened));
  });
  t.querySelector(".go")?.addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-panel" } satisfies ToBackground));
  t.querySelector(".hide")?.addEventListener("click", () => {
    closedFor = pinned?.src ?? "";
    place();
  });
  place();
}

export function showCard(m: RatingMsg) {
  ensureHost();
  // Right-click picks have no element yet: pin to the matching image if we can find it.
  if (!pinned || pinned.src !== m.src) {
    const img = Array.from(document.images).find((i) => (i.currentSrc || i.src) === m.src);
    pinned = img ? { el: img, src: m.src } : pinned;
  }
  if (!pinned) return;
  const fresh = m.state !== "working" && (last?.state === "working" || last?.src !== m.src);
  if (last?.src !== m.src) closedFor = "";
  last = m;
  // A new answer opens with its reason for a few seconds, then folds down to the score.
  if (fresh) {
    opened = true;
    clearTimeout(foldTimer);
    foldTimer = setTimeout(() => { opened = false; tag().classList.remove("open"); tag().querySelector(".chip")?.setAttribute("aria-expanded", "false"); }, 7000);
  }
  render();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
