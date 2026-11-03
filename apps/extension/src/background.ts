import { checkProduct, classifyProduct, type DetectedProduct } from "@zq/core";
import { listItems } from "./lib/db.ts";
import { summarise, type TabState, type ToBackground } from "./lib/messages.ts";
import { getSettings, setSettings } from "./lib/settings.ts";

// Clicking the toolbar icon or pressing Alt+Shift+Z opens the side panel.
chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("app.html#welcome") });
  }
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const tabKey = (id: number) => `tab:${id}`;

export async function analyse(tabId: number, product: DetectedProduct | null) {
  const wardrobe = await listItems();
  const check = product ? checkProduct(classifyProduct(product), wardrobe) : null;
  const state: TabState = { product, check };
  await chrome.storage.session.set({ [tabKey(tabId)]: state });
  const summary = summarise(check, wardrobe.length);
  await setBadge(tabId, product ? summary.tone : null, check);
  return summary;
}

async function setBadge(tabId: number, tone: "good" | "warn" | "neutral" | null, check: TabState["check"]) {
  if (!tone || !check) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  const text = tone === "warn" ? "!" : tone === "good" ? String(check.pairs.length) : "";
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: tone === "warn" ? "#FF9F0A" : "#30B158" });
  await chrome.action.setBadgeTextColor?.({ tabId, color: "#FFFFFF" });
}

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, reply) => {
  const tabId = sender.tab?.id;
  if (msg.type === "product" && tabId != null) {
    analyse(tabId, msg.product).then(reply, (e) => reply({ label: "Zero Q", tone: "neutral", error: String(e) }));
    return true; // async reply
  }
  if (msg.type === "open-panel" && tabId != null) {
    // Must run synchronously inside the click's user gesture.
    chrome.sidePanel.open({ tabId }).catch(() => {});
    return false;
  }
  if (msg.type === "mute-site") {
    getSettings().then((s) => {
      if (!s.mutedSites.includes(msg.host)) setSettings({ mutedSites: [...s.mutedSites, msg.host] });
    });
    return false;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId));
});

// When the wardrobe changes, refresh the badge for the active tab so it
// stays honest ("!" disappears after you delete the duplicate, etc).
const ch = new BroadcastChannel("zeroq-db");
ch.onmessage = async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id == null) return;
  const s = await chrome.storage.session.get(tabKey(tab.id));
  const st = s[tabKey(tab.id)] as TabState | undefined;
  if (st?.product) analyse(tab.id, st.product);
};
