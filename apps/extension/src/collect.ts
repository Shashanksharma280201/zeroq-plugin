import { bestFromSrcset } from "@zq/core";
import type { CollectState, ToBackground, ToContent } from "./lib/messages.ts";
import { candidateAt } from "./pick.ts";

/**
 * Collect mode, on the page. A small tray sits at the bottom; every photo you
 * tap flies into it and lands in Zero Q. Tap a photo again to take it back.
 * Works on any page you can see photos on: Google Photos, Instagram, a blog.
 * Nothing is read until you tap it.
 */

const SPRING = "linear(0, 0.0072, 0.0279, 0.0603, 0.1027, 0.2112, 0.3418, 0.4806, 0.6159, 0.7387, 0.8433, 0.9271, 0.9894, 1.0314, 1.0556, 1.0653, 1.0641, 1.0558, 1.0285, 1.0055, 0.9938, 0.9906, 0.9925, 0.9969, 1)";
const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.500 4.500L19 7.500"/></svg>';

let host: HTMLElement | null = null;
let root: ShadowRoot;
let state: CollectState = { on: false, room: 0, taken: 0 };
let listening = false;
let hovered: { el: Element; src: string } | null = null;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** photos tapped on this page: where they are, and their id once Zero Q has them */
const marks = new Map<Element, { box: HTMLElement; thumb: HTMLElement | null; id?: string; pending: boolean }>();
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const send = (m: ToBackground) => chrome.runtime.sendMessage(m);
const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

function ensureHost() {
  if (host) return;
  host = document.createElement("zeroq-collect");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
  root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>
  * { box-sizing: border-box; }
  :host { --ground: #faf9f6; --ink: #2a2927; --muted: #6b675f; --surface: #f1efea; --lav: #e3dff1; --lav-ink: #4f4585; --sage: #dde6d8; --sage-ink: #3f5a3d; --blush-ink: #86443b;
    --f: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .ring { position: fixed; border-radius: 18px; box-shadow: 0 0 0 3px var(--ground), 0 0 0 6px var(--lav-ink); opacity: 0; transform: scale(.98);
    transition: left .22s cubic-bezier(.32,.72,0,1), top .22s cubic-bezier(.32,.72,0,1), width .22s cubic-bezier(.32,.72,0,1), height .22s cubic-bezier(.32,.72,0,1), opacity .15s, transform .25s ${SPRING}; }
  .ring.on { opacity: 1; transform: none; }
  .ring.out { box-shadow: 0 0 0 3px var(--ground), 0 0 0 6px var(--blush-ink); }
  .ring span { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); height: 32px; padding: 0 14px; border-radius: 999px; background: var(--lav-ink); color: #fff; font: 600 13px/32px var(--f); white-space: nowrap; }
  .ring.out span { background: var(--blush-ink); }
  .mark { position: fixed; border-radius: 16px; background: rgba(221, 230, 216, .34); box-shadow: inset 0 0 0 3px var(--sage-ink); opacity: 0; transition: opacity .2s; }
  .mark.on { opacity: 1; }
  .mark i { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border-radius: 50%; background: var(--sage-ink); color: #fff; display: grid; place-items: center; transform: scale(0); transition: transform .45s ${SPRING}; }
  .mark.on i { transform: scale(1); }
  .mark i svg { width: 15px; height: 15px; }
  .mark.pending i { background: var(--muted); }
  .fly { position: fixed; border-radius: 16px; background-size: cover; background-position: center; box-shadow: 0 18px 40px rgba(42, 41, 39, .28); will-change: transform, opacity; }
  .tray { position: fixed; left: 50%; bottom: 22px; max-width: calc(100vw - 24px); display: flex; align-items: center; gap: 14px; padding: 8px 8px 8px 22px; border-radius: 999px;
    background: var(--ground); color: var(--ink); box-shadow: 0 0 0 1px rgba(42, 41, 39, .07), 0 18px 44px rgba(42, 41, 39, .24); pointer-events: auto;
    transform: translate(-50%, 160%); transition: transform .6s ${SPRING}; }
  .tray.on { transform: translate(-50%, 0); }
  .tray.shake { animation: shake .4s; }
  @keyframes shake { 20% { transform: translate(calc(-50% - 7px), 0); } 45% { transform: translate(calc(-50% + 6px), 0); } 70% { transform: translate(calc(-50% - 3px), 0); } }
  .brand { font: italic 400 21px/1 "Fraunces", ui-serif, Georgia, serif; white-space: nowrap; }
  .msg { font: 500 14px/1.3 var(--f); white-space: nowrap; min-width: 150px; }
  .msg b { font-weight: 700; font-variant-numeric: tabular-nums; display: inline-block; }
  .msg b.bump { animation: bump .45s ${SPRING}; }
  @keyframes bump { from { transform: scale(1.6); } }
  .thumbs { display: flex; align-items: center; padding-left: 8px; }
  .thumbs:empty { display: none; }
  .thumbs span { width: 38px; height: 38px; margin-left: -8px; border-radius: 12px; border: 2px solid var(--ground); background: var(--surface) center / cover; transform: scale(0); transition: transform .5s ${SPRING}, opacity .2s, margin .3s, width .3s; }
  .thumbs span.on { transform: scale(1); }
  .thumbs span.bye { transform: scale(0); opacity: 0; width: 0; margin-left: 0; border-width: 0; }
  .thumbs em { margin-left: 6px; font: 600 12px/1 var(--f); font-style: normal; color: var(--muted); }
  button { all: unset; cursor: pointer; font: 600 14px/1 var(--f); }
  .done { height: 44px; padding: 0 22px; border-radius: 999px; background: var(--ink); color: var(--ground); white-space: nowrap; transition: transform .12s; }
  .done:active, .x:active { transform: scale(.95); }
  .x { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
  .x svg { width: 16px; height: 16px; }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  @media (max-width: 560px) { .brand { display: none; } .msg { min-width: 0; } .tray { gap: 10px; padding-left: 16px; } }
  @media (prefers-color-scheme: dark) { :host { --ground: #1d1c1a; --ink: #f3f1ec; --muted: #ada89e; --surface: #282724; } }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: .01s !important; animation-duration: .01s !important; } }
</style>
<div class="marks"></div>
<div class="ring"><span>Add</span></div>
<div class="tray" role="region" aria-label="Zero Q photo collector">
  <span class="brand" aria-hidden="true">Zero Q</span>
  <span class="msg" role="status" aria-live="polite">Tap the photos of you</span>
  <span class="thumbs" aria-hidden="true"></span>
  <button class="done" type="button">Done</button>
  <button class="x" type="button" aria-label="Stop collecting"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
</div>`;
  $(".done").addEventListener("click", finish);
  $(".x").addEventListener("click", finish);
  document.documentElement.appendChild(host);
  addEventListener("scroll", placeAll, { passive: true, capture: true });
  addEventListener("resize", placeAll, { passive: true });
}

// ---------- the tray ----------

function say(text?: string) {
  const n = state.taken;
  const msg = $(".msg");
  if (text) { msg.textContent = text; return; }
  if (n >= state.room && state.room > 0 && state.on) msg.innerHTML = `<b>${n}</b> added. That is all Zero Q can take.`;
  else if (n === 0) msg.textContent = "Tap the photos of you";
  else msg.innerHTML = `<b>${n}</b> ${n === 1 ? "photo" : "photos"} added`;
}
function bump() {
  const b = root.querySelector(".msg b");
  if (!b) return;
  b.classList.remove("bump");
  void (b as HTMLElement).offsetWidth;
  b.classList.add("bump");
}
function addThumb(src: string): HTMLElement {
  const t = document.createElement("span");
  t.style.backgroundImage = `url("${src.replace(/"/g, "%22")}")`;
  const box = $(".thumbs");
  box.querySelector("em")?.remove();
  box.appendChild(t);
  // keep the strip short: older ones fold into a "+n"
  const all = Array.from(box.querySelectorAll("span:not(.bye)")) as HTMLElement[];
  all.slice(0, Math.max(0, all.length - 5)).forEach((s) => (s.style.display = "none"));
  if (all.length > 5) { const em = document.createElement("em"); em.textContent = `+${all.length - 5}`; box.appendChild(em); }
  requestAnimationFrame(() => t.classList.add("on"));
  return t;
}
function dropThumb(t: HTMLElement | null) {
  if (!t) return;
  t.classList.add("bye");
  setTimeout(() => t.remove(), 320);
}
function shake(text: string) {
  const tray = $(".tray");
  tray.classList.remove("shake");
  void tray.offsetWidth;
  tray.classList.add("shake");
  say(text);
  setTimeout(() => say(), 2600);
}

// ---------- photos on the page ----------

const rectOf = (el: Element) => el.getBoundingClientRect();
function place(box: HTMLElement, el: Element, pad = 0) {
  const b = rectOf(el);
  Object.assign(box.style, { left: `${b.left - pad}px`, top: `${b.top - pad}px`, width: `${b.width + pad * 2}px`, height: `${b.height + pad * 2}px` });
}
let raf = 0;
function placeAll() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const [el, m] of marks) {
      if (!el.isConnected) { m.box.remove(); marks.delete(el); continue; }
      place(m.box, el);
    }
    if (hovered) place($(".ring"), hovered.el, 4);
  });
}

/** The best address for a photo: the biggest file the page offers for it. */
function bestSrc(c: { el: Element; src: string }): string {
  const img = c.el instanceof HTMLImageElement ? c.el : null;
  const big = bestFromSrcset(img?.getAttribute("srcset") ?? (img?.parentElement?.tagName === "PICTURE" ? img.parentElement.querySelector("source")?.getAttribute("srcset") : null));
  try { return big ? new URL(big, location.href).href : c.src; } catch { return c.src; }
}

function fly(src: string, from: DOMRect, done: () => void) {
  if (calm()) return done();
  const tray = $(".tray").getBoundingClientRect();
  const thumbs = $(".thumbs").getBoundingClientRect();
  const tx = (thumbs.width ? thumbs.right : tray.left + tray.width * 0.62) - 19, ty = tray.top + tray.height / 2 - 19;
  const f = document.createElement("div");
  f.className = "fly";
  f.style.backgroundImage = `url("${src.replace(/"/g, "%22")}")`;
  Object.assign(f.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, transformOrigin: "0 0" });
  root.appendChild(f);
  const s = 38 / Math.max(from.width, from.height);
  const dx = tx - from.left, dy = ty - from.top;
  // a little lift first, then a curve down into the tray
  const a = f.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1, borderRadius: "16px" },
    { transform: `translate(${dx * 0.12}px, ${-18}px) scale(${1 - (1 - s) * 0.18})`, opacity: 1, offset: 0.18 },
    { transform: `translate(${dx * 0.7}px, ${dy * 0.55}px) scale(${s * 1.9})`, opacity: 1, offset: 0.72 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.2, borderRadius: "40px" },
  ], { duration: 620, easing: "cubic-bezier(.3, .6, .25, 1)", fill: "forwards" });
  a.onfinish = a.oncancel = () => { f.remove(); done(); };
}

async function tap(c: { el: Element; src: string }) {
  const had = marks.get(c.el);
  if (had) {
    if (had.pending) return;
    // tap again: take it back
    had.box.classList.remove("on");
    setTimeout(() => had.box.remove(), 220);
    dropThumb(had.thumb);
    marks.delete(c.el);
    if (hovered?.el === c.el) showRing(c);
    if (had.id) { const r = await send({ type: "collect-remove", id: had.id }).catch(() => null); if (r?.state) state = r.state; }
    say();
    return;
  }
  if (state.taken + [...marks.values()].filter((m) => m.pending).length >= state.room) return shake("That is all Zero Q can take");
  const src = bestSrc(c), from = rectOf(c.el);
  const box = document.createElement("div");
  box.className = "mark pending";
  box.innerHTML = `<i>${TICK}</i>`;
  $(".marks").appendChild(box);
  place(box, c.el);
  requestAnimationFrame(() => box.classList.add("on"));
  const mark = { box, thumb: null as HTMLElement | null, id: undefined as string | undefined, pending: true };
  marks.set(c.el, mark);
  if (hovered?.el === c.el) showRing(c);
  let landed = false, failed = false;
  fly(c.src, from, () => { landed = true; if (!failed) mark.thumb = addThumb(c.src); });
  const r = await send({ type: "collect-add", src, rect: { x: from.left, y: from.top, w: from.width, h: from.height, dpr: devicePixelRatio } }).catch(() => null);
  if (r?.ok) {
    mark.id = r.id;
    mark.pending = false;
    box.classList.remove("pending");
    state = r.state;
    say();
    bump();
  } else {
    failed = true;
    box.remove();
    marks.delete(c.el);
    if (landed) dropThumb(mark.thumb);
    shake(r?.full ? "That is all Zero Q can take" : "Could not read that photo");
  }
}

// ---------- pointer and keys ----------

function onMove(e: PointerEvent) {
  showRing(candidateAt(e.clientX, e.clientY));
}
function showRing(c: { el: Element; src: string } | null) {
  hovered = c;
  const ring = $(".ring");
  if (!c) return ring.classList.remove("on");
  const mine = marks.has(c.el);
  ring.classList.toggle("out", mine);
  ring.querySelector("span")!.textContent = mine ? "Remove" : "Add";
  place(ring, c.el, 4);
  ring.classList.add("on");
}
function onClick(e: MouseEvent) {
  const c = candidateAt(e.clientX, e.clientY);
  if (!c) return; // menus, albums and links keep working
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  tap(c);
}
const swallow = (e: Event) => {
  const p = e as PointerEvent;
  if (candidateAt(p.clientX, p.clientY)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
};
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") finish();
}

function listen(on: boolean) {
  if (on === listening) return;
  listening = on;
  const f = on ? addEventListener : removeEventListener;
  f("pointermove", onMove as EventListener, true);
  f("click", onClick as EventListener, true);
  f("mousedown", swallow, true);
  f("mouseup", swallow, true);
  f("pointerdown", swallow, true);
  f("pointerup", swallow, true);
  f("keydown", onKey as EventListener, true);
}

function apply(next: CollectState) {
  const was = state.on;
  state = next;
  if (next.on) {
    ensureHost();
    clearTimeout(flashTimer);
    listen(true);
    say();
    requestAnimationFrame(() => $(".tray").classList.add("on"));
  } else if (was && host) {
    listen(false);
    hovered = null;
    $(".ring").classList.remove("on");
    $(".tray").classList.remove("on");
    for (const m of marks.values()) m.box.remove();
    marks.clear();
    setTimeout(() => { if (!state.on) $(".thumbs").innerHTML = ""; }, 700);
  }
}

function finish() {
  send({ type: "collect-done" }).catch(() => {});
  apply({ ...state, on: false });
}

/** Right-click "Use as my outfit photo" outside collect mode: a brief word that it landed. */
function flash(ok: boolean) {
  if (state.on) return;
  ensureHost();
  const tray = $(".tray");
  $(".done").style.display = $(".x").style.display = "none";
  say(ok ? "Added to your Zero Q photos" : "Could not read that photo");
  tray.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    tray.classList.remove("on");
    setTimeout(() => { if (!state.on) $(".done").style.display = $(".x").style.display = ""; }, 600);
  }, 2400);
}

export function initCollect() {
  chrome.runtime.onMessage.addListener((m: ToContent, _s, reply) => {
    if (m.type === "collect") apply(m.state);
    else if (m.type === "collect-flash") flash(m.ok);
    else if (m.type === "collect-veil") {
      // step aside for a screenshot of the page, then come back
      if (host) host.style.visibility = m.on ? "visible" : "hidden";
      requestAnimationFrame(() => requestAnimationFrame(() => reply(true)));
      return true;
    }
    return false;
  });
  send({ type: "collect-state" }).then((s: CollectState | undefined) => { if (s?.on) apply(s); }).catch(() => {});
}
