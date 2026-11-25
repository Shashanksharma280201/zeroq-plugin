import type { ToBackground } from "./lib/messages.ts";

/**
 * Shared by everything Zero Q draws on a web page (the pill, the score tag,
 * the photo tray): the calm colours, the typeface, and whether the side panel
 * is open. While the panel is open the page stays clear, because the answer is
 * already showing there.
 */

export const PAGE_FONT = `"ZQ Bricolage", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

/** The calm palette, for a shadow root. Dark values follow the device, like the panel does. */
export const PAGE_TOKENS = `
  :host { --milk: #faf9f6; --stone: #f1efea; --ink: #2a2927; --pebble: #6b675f; --line: rgba(42,41,39,.09);
    --sage: #dde6d8; --sage-ink: #3f5a3d; --butter: #f4eac6; --butter-ink: #6e5716; --blush: #f1dad5; --blush-ink: #86443b; --lav: #e3dff1; --lav-ink: #4f4585;
    --lift: 0 0 0 1px var(--line), 0 10px 28px rgba(42,41,39,.16);
    --f: ${PAGE_FONT}; --settle: cubic-bezier(.32,.72,0,1); --spring: cubic-bezier(.34,1.4,.5,1); }
  @media (prefers-color-scheme: dark) {
    :host { --milk: #282724; --stone: #32312d; --ink: #f3f1ec; --pebble: #ada89e; --line: rgba(255,255,255,.1);
      --sage: #33402f; --sage-ink: #cfe0c8; --butter: #453c1c; --butter-ink: #efdfa6; --blush: #4a2f2b; --blush-ink: #f0cfc8; --lav: #35304f; --lav-ink: #d5cef2;
      --lift: 0 0 0 1px var(--line), 0 10px 28px rgba(0,0,0,.45); }
  }`;

let fontAsked = false;
/**
 * Brings Zero Q's typeface onto the page. The font file comes from the
 * extension as bytes, so nothing is fetched by the page and the page's own
 * rules about fonts do not get in the way. Until it arrives (or if it cannot)
 * the device's own font is used.
 */
export function pageFont(): void {
  if (fontAsked) return;
  fontAsked = true;
  chrome.runtime.sendMessage({ type: "font" } satisfies ToBackground).then((b64: string | null) => {
    if (!b64) return;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const face = new FontFace("ZQ Bricolage", bytes.buffer, { weight: "200 800" });
    return face.load().then(() => { document.fonts.add(face); });
  }).catch(() => {});
}

let open = false;
const watchers = new Set<(open: boolean) => void>();

export const panelOpen = () => open;
export function onPanel(fn: (open: boolean) => void): void {
  watchers.add(fn);
}
export function setPanelOpen(v: boolean): void {
  if (v === open) return;
  open = v;
  for (const fn of watchers) fn(open);
}
/** Asks once, at the start; after that the background says when it changes. */
export function watchPanel(): void {
  chrome.runtime.sendMessage({ type: "panel-state" } satisfies ToBackground).then((v) => setPanelOpen(v === true), () => {});
}
