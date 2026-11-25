/**
 * Tells the background that the side panel is showing, for as long as it is.
 *
 * The page next to the panel keeps its own Zero Q pieces (the pill, the score
 * tag) out of the way while the panel is open, and brings them back when it
 * closes. The browser has no "the panel closed" signal that works everywhere,
 * so the panel holds a line open: when the panel goes away the line drops, and
 * that is the signal. A small message every 20 seconds keeps the background
 * awake to hear it.
 */
export async function announcePanel(): Promise<void> {
  // Zero Q opened in an ordinary tab (browsers without a side panel) is not beside the page: say nothing.
  const inTab = await chrome.tabs.getCurrent().catch(() => undefined);
  if (inTab) return;
  const win = await chrome.windows.getCurrent().catch(() => undefined);
  if (win?.id == null) return;
  let port: chrome.runtime.Port | null = null;
  const connect = () => {
    try {
      port = chrome.runtime.connect({ name: "panel" });
      port.postMessage({ windowId: win.id });
      // the background was restarted: call again
      port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 400); });
    } catch {
      port = null;
    }
  };
  connect();
  setInterval(() => {
    try { port?.postMessage({ still: true }); } catch { /* reconnects on its own */ }
  }, 20_000);
}
