import { openPanel } from "./lib/platform.ts";
import { checkProduct, classifyProduct, type DetectedProduct } from "@zq/core";
import { listItems } from "./lib/db.ts";
import { backfill, itemKeyOf, logEvent, rebuildMemory } from "./lib/events.ts";
import { notesDue, writeTasteNotes } from "./lib/notes.ts";
import { aiReady, getSettings } from "./lib/settings.ts";
import { syncNow } from "./lib/sync.ts";
import { summarise, type Pick, type TabState, type ToBackground } from "./lib/messages.ts";
import { setSettings } from "./lib/settings.ts";

// Clicking the toolbar icon or pressing Alt+Shift+Z opens the side panel.
chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  setupAlarms();
  backfill().catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "zq-rate", title: "Rate this for me with Zero Q", contexts: ["image"] });
  });
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("app.html#style") });
  }
});

// ---------- point at any item ----------

const pickKey = (id: number) => `pick:${id}`;

async function storePick(tabId: number, pick: Pick) {
  await chrome.storage.session.set({ [pickKey(tabId)]: pick });
}

// Without a side panel (Firefox's sidebar aside), the toolbar button opens Zero Q itself.
chrome.action.onClicked.addListener((tab) => openPanel(tab.id));

// Right-click any image: open the panel (must be first, inside the gesture) and rate it.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "zq-rate" || tab?.id == null || !info.srcUrl) return;
  openPanel(tab.id);
  storePick(tab.id, { src: info.srcUrl, title: tab.title ?? "", url: info.pageUrl ?? tab.url ?? "", at: Date.now() });
  logEvent("item_picked", { url: info.pageUrl ?? tab.url, src: info.srcUrl, title: tab.title, via: "menu" }).catch(() => {});
});

// Alt+Shift+X: start pick mode on the page.
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "pick-item") return;
  const id = tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (id != null) chrome.tabs.sendMessage(id, { type: "pick-start" }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  setupAlarms();
  backfill().catch(() => {});
});

const tabKey = (id: number) => `tab:${id}`;

export async function analyse(tabId: number, product: DetectedProduct | null) {
  const wardrobe = await listItems();
  const check = product ? checkProduct(classifyProduct(product), wardrobe) : null;
  const state: TabState = { product, check };
  await chrome.storage.session.set({ [tabKey(tabId)]: state });
  if (product) noteView(tabId, product).catch(() => {});
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
    openPanel(tabId);
    return false;
  }
  if (msg.type === "picked" && tabId != null) {
    openPanel(tabId);
    storePick(tabId, { src: msg.src, title: msg.title, url: msg.url, alt: msg.alt, at: Date.now() });
    logEvent("item_picked", { url: msg.url, src: msg.src, title: msg.title, name: msg.alt, via: "point" }).catch(() => {});
    return false;
  }
  if (msg.type === "sync-now") {
    syncNow().then((s) => reply({ ok: true, state: s }), (e) => reply({ ok: false, error: e?.message ?? String(e) }));
    return true;
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
  chrome.storage.session.remove([tabKey(tabId), pickKey(tabId)]);
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

// ---------- memory and sync ----------

/** One product_viewed per product per day. */
async function noteView(tabId: number, p: DetectedProduct) {
  const itemKey = itemKeyOf(p.url);
  const k = `viewed:${itemKey}:${new Date().toISOString().slice(0, 10)}`;
  if ((await chrome.storage.session.get(k))[k]) return;
  await chrome.storage.session.set({ [k]: 1 });
  const c = classifyProduct(p);
  await logEvent("product_viewed", { itemKey, url: p.url, name: p.name, brand: p.brand, price: p.price, currency: p.currency, category: c.category, colors: c.colors, formality: c.formality, image: p.images[0] }, { itemKey, brand: p.brand });
}

function setupAlarms() {
  chrome.alarms?.create("zq-memory", { periodInMinutes: 24 * 60, delayInMinutes: 1 });
  chrome.alarms?.create("zq-sync", { periodInMinutes: 15, delayInMinutes: 1 });
}

chrome.alarms?.onAlarm.addListener(async (a) => {
  if (a.name === "zq-sync") syncNow().catch(() => {});
  if (a.name === "zq-memory") {
    await rebuildMemory().catch(() => {});
    if (aiReady(await getSettings()) && (await notesDue().catch(() => false))) writeTasteNotes().catch(() => {});
  }
});

// New events: push them to Drive about half a minute later, in one batch.
let pushTimer: ReturnType<typeof setTimeout> | undefined;
const evch = new BroadcastChannel("zeroq-events");
evch.onmessage = (e) => {
  if (e.data?.kind !== "event" || e.data?.type === "sync") return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow().catch(() => {}), 30_000);
};

backfill().catch(() => {});
