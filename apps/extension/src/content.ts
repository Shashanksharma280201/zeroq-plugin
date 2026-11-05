import { detectProduct, productLinks } from "@zq/core";
import type { PillSummary, ToBackground, ToContent } from "./lib/messages.ts";
import { getSettings, onSettings, type Settings } from "./lib/settings.ts";
import { showCard, startPick } from "./pick.ts";

/**
 * Runs on every page. Cheap by design: one pass over <script type=ld+json>
 * and a few meta tags. Only product pages get a pill; everything else is
 * left untouched.
 */

let settings: Settings;
let lastUrl = "";
let lastKey = "";
let pill: ReturnType<typeof createPill> | null = null;
let dismissedFor = "";

const send = (m: ToBackground) => chrome.runtime.sendMessage(m);

async function run(force = false) {
  const url = location.href;
  const muted = settings.mutedSites.some((h) => location.hostname === h || location.hostname.endsWith(`.${h}`));
  if (!force && (settings.trigger === "off" || muted)) {
    pill?.hide();
    return;
  }
  const product = detectProduct(document, url);
  const key = product ? `${product.name}|${product.price}|${product.images[0]}` : "";
  if (!force && key === lastKey) return;
  lastKey = key;
  const summary = (await send({ type: "product", product }).catch(() => null)) as PillSummary | null;
  if (!product || !summary) {
    pill?.hide();
    return;
  }
  if (settings.trigger === "auto" && !muted && dismissedFor !== url) {
    pill ??= createPill();
    pill.show(summary);
  }
}

/** Product pages often render after load, and many stores are single page apps. */
function schedule() {
  for (const ms of [0, 1200, 3500]) setTimeout(() => run(), ms);
}

async function init() {
  settings = await getSettings();
  onSettings((s) => {
    settings = s;
    lastKey = "";
    run();
  });
  lastUrl = location.href;
  schedule();
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastKey = "";
      pill?.hide();
      schedule();
    }
  }, 700);
  chrome.runtime.onMessage.addListener((m: ToContent, _s, reply) => {
    if (m.type === "pick-start") startPick();
    if (m.type === "links") {
      reply(productLinks(document, location.origin));
      return false;
    }
    if (m.type === "rating") showCard(m);
    if (m.type === "detect") {
      reply(detectProduct(document, location.href));
      lastKey = "";
      run(true);
    }
    return false;
  });
}

// ---------- the pill ----------

function createPill() {
  const host = document.createElement("zeroq-pill");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;right:20px;bottom:20px;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>
  :host { all: initial; --ink: #1f201d; --muted: #5f605c; --surface: #ffffff; --line: rgba(0,0,0,.08); --pos: #2e7d32; --warn: #b45309; --neu: #8a8a86;
    --settle: cubic-bezier(.32,.72,0,1); }
  .wrap { display: flex; align-items: center; gap: 6px; font: 500 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; letter-spacing: -0.01em; color: var(--ink);
    transform-origin: 100% 100%; opacity: 0; transform: translateY(10px); transition: opacity .25s ease, transform .4s var(--settle); pointer-events: none; }
  .wrap.on { opacity: 1; transform: none; pointer-events: auto; }
  button { all: unset; cursor: pointer; -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  .pill, .rate, .x, .toast { background: var(--surface); box-shadow: 0 0 0 1px var(--line), 0 8px 24px rgba(0,0,0,.14); }
  .pill { background: #141210; color: #fbf8f2; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
  .pill .chev { opacity: .6; }
  .pill { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 16px 0 12px; border-radius: 22px; transition: transform .1s ease-out; }
  .pill:active, .rate:active { transform: scale(.96); }
  .pill:focus-visible, .x:focus-visible, .rate:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .mark { width: 20px; height: 20px; flex: none; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--neu); flex: none; }
  .good .dot { background: var(--pos); } .warn .dot { background: var(--warn); }
  .chev { opacity: .45; font-size: 18px; margin-left: -2px; }
  .rate { width: 44px; height: 44px; border-radius: 22px; display: grid; place-items: center; color: var(--ink); transition: transform .1s ease-out; }
  .rate svg { width: 20px; height: 20px; }
  .x { width: 28px; height: 28px; border-radius: 14px; display: grid; place-items: center; color: var(--muted); font-size: 13px; opacity: 0; transform: scale(.8); transition: opacity .15s ease, transform .2s var(--settle); }
  .wrap:hover .x, .x:focus-visible { opacity: 1; transform: none; }
  .toast { position: absolute; right: 0; bottom: 54px; white-space: nowrap; display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-radius: 14px; font-size: 13px;
    opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .3s var(--settle); pointer-events: none; }
  .toast.on { opacity: 1; transform: none; pointer-events: auto; }
  .toast button { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
  @media (prefers-color-scheme: dark) { :host { --ink: #ffffff; --muted: #b4b4b4; --surface: #1c1c1c; --line: rgba(255,255,255,.1); --pos: #3fc07a; --warn: #e5a93b; } }
  @media (prefers-reduced-motion: reduce) { .wrap, .pill, .x, .toast, .rate { transition-duration: .01s !important; } }
</style>
<div class="wrap" part="wrap">
  <button class="x" aria-label="Hide on this page">✕</button>
  <button class="rate" aria-label="Point at an item to rate it" title="Rate an item (Alt+Shift+X)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg></button>
  <button class="pill" aria-label="Open Zero Q"><svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><path d="M15.6 15.6 20.5 20.5"/></svg><span class="dot"></span><span class="label"></span><span class="chev">›</span></button>
  <div class="toast" role="status"><span>Hidden on this page.</span><button class="mute">Hide on this site</button></div>
</div>`;
  const wrap = root.querySelector(".wrap") as HTMLElement;
  const pillEl = root.querySelector(".pill") as HTMLElement;
  const label = root.querySelector(".label") as HTMLElement;
  const toast = root.querySelector(".toast") as HTMLElement;
  pillEl.addEventListener("click", () => send({ type: "open-panel" }));
  root.querySelector(".rate")!.addEventListener("click", () => startPick());
  root.querySelector(".x")!.addEventListener("click", () => {
    dismissedFor = location.href;
    pillEl.style.display = "none";
    (root.querySelector(".x") as HTMLElement).style.display = "none";
    (root.querySelector(".rate") as HTMLElement).style.display = "none";
    toast.classList.add("on");
    setTimeout(() => api.hide(), 4000);
  });
  root.querySelector(".mute")!.addEventListener("click", () => {
    send({ type: "mute-site", host: location.hostname.replace(/^www\./, "") });
    api.hide();
  });
  document.documentElement.appendChild(host);

  const api = {
    show(s: PillSummary) {
      pillEl.style.display = "";
      (root.querySelector(".rate") as HTMLElement).style.display = "";
      (root.querySelector(".x") as HTMLElement).style.display = "";
      toast.classList.remove("on");
      label.textContent = s.label;
      pillEl.className = `pill ${s.tone}`;
      requestAnimationFrame(() => wrap.classList.add("on"));
    },
    hide() {
      wrap.classList.remove("on");
      toast.classList.remove("on");
    },
  };
  return api;
}

init();
