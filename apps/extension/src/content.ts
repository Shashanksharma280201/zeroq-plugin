import { detectProduct } from "@zq/core";
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
  :host { all: initial; }
  .wrap { display: flex; align-items: center; gap: 6px; font: 500 14px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; letter-spacing: -0.01em;
    transform-origin: 100% 100%; opacity: 0; transform: translateY(14px) scale(.9); filter: blur(6px);
    transition: opacity .35s ease, transform .6s var(--spring), filter .35s ease; pointer-events: none; }
  .wrap.on { opacity: 1; transform: none; filter: none; pointer-events: auto; }
  :host { --spring: linear(0, 0.0156, 0.0612, 0.1336, 0.2286, 0.3404, 0.4628, 0.5893, 0.7137, 0.83, 0.9338, 1.0216, 1.0915, 1.143, 1.177, 1.1953, 1.2003, 1.1948, 1.1817, 1.1636, 1.1427, 1.0817, 1.0346, 1.0059, 0.9916, 0.9873, 0.9963, 1); }
  button { all: unset; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .pill { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 16px 0 6px; border-radius: 22px;
    color: #1d1d1f; background: rgba(250,250,252,.72); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 8px 28px rgba(0,0,0,.14), 0 1px 2px rgba(0,0,0,.06);
    transition: transform .45s var(--spring), box-shadow .3s ease; }
  .pill:hover { box-shadow: 0 0 0 .5px rgba(0,0,0,.14), 0 12px 36px rgba(0,0,0,.18), 0 1px 2px rgba(0,0,0,.06); }
  .pill:active { transform: scale(.95); transition-duration: .15s; }
  .pill:focus-visible, .x:focus-visible { outline: 3px solid rgba(94,92,230,.55); outline-offset: 2px; }
  .mark { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(180deg,#5E5CE6,#3430AA); color: #fff; font-weight: 700; font-size: 15px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #8e8e93; }
  .good .dot { background: #30B158; } .warn .dot { background: #FF9F0A; }
  .chev { opacity: .45; font-size: 18px; margin-left: -2px; }
  .rate { width: 44px; height: 44px; border-radius: 22px; display: grid; place-items: center; color: #5E5CE6;
    background: rgba(250,250,252,.72); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 8px 28px rgba(0,0,0,.14); transition: transform .45s var(--spring); }
  .rate svg { width: 22px; height: 22px; } .rate:active { transform: scale(.9); }
  .x { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: #6e6e73; font-size: 15px;
    background: rgba(250,250,252,.72); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 4px 14px rgba(0,0,0,.1);
    opacity: 0; transform: scale(.6); transition: opacity .2s ease, transform .4s var(--spring); }
  .wrap:hover .x, .x:focus-visible { opacity: 1; transform: none; }
  .toast { position: absolute; right: 0; bottom: 56px; white-space: nowrap; display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-radius: 14px;
    color: #1d1d1f; background: rgba(250,250,252,.8); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 8px 28px rgba(0,0,0,.14); font-size: 13px; opacity: 0; transform: translateY(8px); transition: opacity .25s, transform .5s var(--spring); pointer-events: none; }
  .toast.on { opacity: 1; transform: none; pointer-events: auto; }
  .toast button { color: #5E5CE6; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .rate { color: #8f8cff; background: rgba(44,44,46,.72); }
    .pill, .x, .toast { color: #f5f5f7; background: rgba(44,44,46,.72); box-shadow: 0 0 0 .5px rgba(255,255,255,.12), 0 8px 28px rgba(0,0,0,.45); }
    .x { color: #aeaeb2; } .toast button { color: #8f8cff; }
  }
  @media (prefers-reduced-motion: reduce) { .wrap, .pill, .x, .toast { transition-duration: .01s !important; filter: none !important; } }
</style>
<div class="wrap" part="wrap">
  <button class="x" aria-label="Hide on this page">✕</button>
  <button class="rate" aria-label="Point at an item to rate it" title="Rate an item (Alt+Shift+X)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg></button>
  <button class="pill" aria-label="Open Zero Q"><span class="mark">Q</span><span class="dot"></span><span class="label"></span><span class="chev">›</span></button>
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
