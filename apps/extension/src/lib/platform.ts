/**
 * One codebase, every browser.
 *
 *  Chrome, Edge, Brave:   the side panel (chrome.sidePanel)
 *  Firefox:               the sidebar (browser.sidebarAction)
 *  Safari, Opera, Arc:    no side panel API, so Zero Q opens in a tab pinned to the shop tab
 *
 * Firefox and Safari also expose `browser`, the promise-based twin of
 * `chrome`. Where it exists we use it under the `chrome` name so the rest of
 * the code stays the same.
 */
const g = globalThis as any;
if (g.browser?.runtime?.id && g.chrome !== g.browser) {
  try {
    g.chrome = g.browser;
  } catch {}
}

export type PanelKind = "sidepanel" | "sidebar" | "tab";
export const panelKind = (): PanelKind => (g.chrome?.sidePanel?.open ? "sidepanel" : g.browser?.sidebarAction?.open ? "sidebar" : "tab");

/** Drive sync needs a web sign-in flow; Safari does not have one for extensions. */
export const canSignIn = () => typeof g.chrome?.identity?.launchWebAuthFlow === "function";

/** Opens Zero Q next to a tab. Call it straight from a click or shortcut: browsers only allow it inside the gesture. */
export function openPanel(tabId?: number): void {
  const k = panelKind();
  if (k === "sidepanel" && tabId != null) {
    g.chrome.sidePanel.open({ tabId }).catch(() => openTab(tabId));
    return;
  }
  if (k === "sidebar") {
    g.browser.sidebarAction.open().catch(() => openTab(tabId));
    return;
  }
  openTab(tabId);
}

/** Zero Q in its own tab, following the shop tab it was opened from. Reuses one tab. */
export async function openTab(tabId?: number): Promise<void> {
  const base = chrome.runtime.getURL("sidepanel.html");
  const url = tabId != null ? `${base}?tab=${tabId}` : base;
  const open = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(base));
  if (open?.id != null) {
    await chrome.tabs.update(open.id, { url, active: true });
    if (open.windowId != null) chrome.windows?.update(open.windowId, { focused: true }).catch?.(() => {});
  } else {
    await chrome.tabs.create({ url, index: undefined });
  }
}

/**
 * Where Google sends you back after sign-in. Chrome and its relatives use the
 * extension's own chromiumapp.org address. Google refuses Firefox's default
 * address (it cannot verify the domain), so Firefox uses the loopback address
 * it offers for exactly this.
 */
export function googleRedirect(): string {
  const u: string = g.chrome.identity.getRedirectURL();
  const m = u.match(/^https:\/\/([0-9a-f]+)\.extensions\.allizom\.org\//);
  return m ? `http://127.0.0.1/mozoauth2/${m[1]}` : u;
}
