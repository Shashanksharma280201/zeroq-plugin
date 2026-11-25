import "./lib/platform.ts";
import { detectProduct, productLinks } from "@zq/core";
import { relatedImages } from "./related.ts";
import type { PillSummary, ToBackground, ToContent } from "./lib/messages.ts";
import { getSettings, onSettings, type Settings } from "./lib/settings.ts";
import { initCollect } from "./collect.ts";
import { PAGE_TOKENS, onPanel, pageFont, panelOpen, setPanelOpen, watchPanel } from "./onpage.ts";
import { showCard, startPick } from "./pick.ts";

/**
 * Runs on every page. Cheap by design: one pass over <script type=ld+json>
 * and a few meta tags. Only product pages get a pill; everything else is
 * left untouched. While the side panel is open the pill stays away: the
 * answer is already on screen there.
 */

let settings: Settings;
let lastUrl = "";
let lastKey = "";
let pill: ReturnType<typeof createPill> | null = null;
let dismissedFor = "";
let summary: PillSummary | null = null;

/** Shows or hides the pill for what is known right now. */
function showPill() {
  const muted = settings.mutedSites.some((h) => location.hostname === h || location.hostname.endsWith(`.${h}`));
  if (!summary || panelOpen() || settings.trigger !== "auto" || muted || dismissedFor === location.href) {
    pill?.hide();
    return;
  }
  pageFont();
  pill ??= createPill();
  pill.show(summary);
}

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
  const got = (await send({ type: "product", product }).catch(() => null)) as PillSummary | null;
  summary = product && got ? got : null;
  showPill();
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
  onPanel(showPill);
  watchPanel();
  schedule();
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastKey = "";
      summary = null;
      pill?.hide();
      schedule();
    }
  }, 700);
  chrome.runtime.onMessage.addListener((m: ToContent, _s, reply) => {
    if (m.type === "pick-start") startPick();
    if (m.type === "panel") setPanelOpen(m.open);
    if (m.type === "related") {
      reply(relatedImages(m.src).slice(1));
      return false;
    }
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
<style>${PAGE_TOKENS}
  .wrap { display: flex; align-items: center; gap: 6px; color: var(--ink); opacity: 0; transform: translateY(12px) scale(.96); transform-origin: 100% 100%;
    transition: opacity .25s ease, transform .45s var(--settle); pointer-events: none; }
  .wrap.on { opacity: 1; transform: none; pointer-events: auto; }
  button { all: unset; cursor: pointer; -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  .pill, .rate, .x, .toast { background: var(--milk); box-shadow: var(--lift); }
  .pill { display: flex; align-items: center; height: 44px; padding: 0 6px; border-radius: 22px; font: 600 14px/1 var(--f); letter-spacing: -.01em; transition: transform .15s ease-out; }
  .pill:active, .rate:active { transform: scale(.96); }
  .pill:focus-visible, .x:focus-visible, .rate:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .badge { width: 32px; height: 32px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--stone); color: var(--ink); transition: background .3s; }
  .badge svg { width: 17px; height: 17px; }
  .good .badge { background: var(--sage); color: var(--sage-ink); }
  .warn .badge { background: var(--butter); color: var(--butter-ink); }
  /* the words fold away after a few seconds, so the pill takes little room; they come back when you point at it */
  .label { white-space: nowrap; overflow: hidden; max-width: 240px; padding: 0 10px 0 10px; transition: max-width .5s var(--settle), padding .5s var(--settle), opacity .3s; }
  .wrap.small:not(:hover):not(:focus-within) .label { max-width: 0; padding: 0; opacity: 0; }
  .rate, .x { display: grid; place-items: center; color: var(--ink); transition: opacity .2s ease, transform .3s var(--settle); }
  .rate { width: 44px; height: 44px; border-radius: 22px; }
  .rate svg { width: 20px; height: 20px; }
  .x { width: 28px; height: 28px; border-radius: 14px; color: var(--pebble); font: 500 13px/1 var(--f); }
  .wrap:not(:hover):not(:focus-within) .x, .wrap.small:not(:hover):not(:focus-within) .rate { opacity: 0; transform: scale(.7); pointer-events: none; }
  .toast { position: absolute; right: 0; bottom: 54px; white-space: nowrap; display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 20px; font: 500 13px/1 var(--f);
    opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .3s var(--settle); pointer-events: none; }
  .toast.on { opacity: 1; transform: none; pointer-events: auto; }
  .toast button { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) { .wrap, .pill, .label, .x, .toast, .rate { transition-duration: .01s !important; } }
</style>
<div class="wrap" part="wrap">
  <button class="x" aria-label="Hide on this page">✕</button>
  <button class="rate" aria-label="Point at an item to rate it" title="Rate an item (Alt+Shift+X)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg></button>
  <button class="pill"><span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7.5"/><path d="M15.6 15.6 20.5 20.5"/></svg></span><span class="label"></span></button>
  <div class="toast" role="status"><span>Hidden on this page.</span><button class="mute">Hide on this site</button></div>
</div>`;
  const wrap = root.querySelector(".wrap") as HTMLElement;
  const pillEl = root.querySelector(".pill") as HTMLElement;
  const label = root.querySelector(".label") as HTMLElement;
  const toast = root.querySelector(".toast") as HTMLElement;
  let fold: ReturnType<typeof setTimeout> | undefined;
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
      const changed = label.textContent !== s.label || !wrap.classList.contains("on");
      label.textContent = s.label;
      pillEl.setAttribute("aria-label", `Zero Q: ${s.label}. Open the answer.`);
      pillEl.className = `pill ${s.tone}`;
      if (changed) {
        wrap.classList.remove("small");
        clearTimeout(fold);
        fold = setTimeout(() => wrap.classList.add("small"), 6000);
      }
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
initCollect();
