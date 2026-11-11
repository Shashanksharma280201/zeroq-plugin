import { openPanel } from "./lib/platform.ts";
import { checkProduct, classifyProduct, largerImageUrl, type DetectedProduct } from "@zq/core";
import { COLLECT_KEY, GONE_KEY, INBOX_KEY, OFF, getCollect, inboxBlobKey } from "./lib/collect.ts";
import { deleteBlob, listItems, putBlob } from "./lib/db.ts";
import { backfill, itemKeyOf, logEvent, rebuildMemory, ulid } from "./lib/events.ts";
import { downscale } from "./lib/images.ts";
import { notesDue, writeTasteNotes } from "./lib/notes.ts";
import { aiReady, getSettings } from "./lib/settings.ts";
import { syncNow } from "./lib/sync.ts";
import { saveToDownloads } from "./lib/folder.ts";
import { summarise, type CollectState, type Pick, type Rect, type TabState, type ToBackground, type ToContent } from "./lib/messages.ts";
import { setSettings } from "./lib/settings.ts";

// Clicking the toolbar icon or pressing Alt+Shift+Z opens the side panel.
chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  setupAlarms();
  backfill().catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "zq-rate", title: "Rate this for me with Zero Q", contexts: ["image"] });
    chrome.contextMenus.create({ id: "zq-mine", title: "Use as my outfit photo in Zero Q", contexts: ["image"] });
  });
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("app.html#setup") });
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
  if (info.menuItemId === "zq-mine" && tab?.id != null && info.srcUrl) {
    const id = tab.id;
    collectAdd(id, info.srcUrl, undefined, true).then((r) => chrome.tabs.sendMessage(id, { type: "collect-flash", ok: r.ok } satisfies ToContent).catch(() => {}));
    return;
  }
  if (info.menuItemId !== "zq-rate" || tab?.id == null || !info.srcUrl) return;
  openPanel(tab.id);
  const pick = { src: info.srcUrl, title: tab.title ?? "", url: info.pageUrl ?? tab.url ?? "", at: Date.now() };
  // Ask the page for the product's other photos; the rating waits a moment for them.
  chrome.tabs.sendMessage(tab.id, { type: "related", src: info.srcUrl }).then(
    (more: string[]) => storePick(tab.id!, { ...pick, more: Array.isArray(more) ? more : [] }),
    () => storePick(tab.id!, pick),
  );
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
    storePick(tabId, { src: msg.src, title: msg.title, url: msg.url, alt: msg.alt, more: msg.more, at: Date.now() });
    logEvent("item_picked", { url: msg.url, src: msg.src, title: msg.title, name: msg.alt, via: "point" }).catch(() => {});
    return false;
  }
  if (msg.type === "collect-start") {
    collectStart(msg.url, msg.room, tabId).then(reply);
    return true;
  }
  if (msg.type === "collect-state") {
    getCollect().then(reply);
    return true;
  }
  if (msg.type === "collect-add" && tabId != null) {
    collectAdd(tabId, msg.src, msg.rect).then(reply);
    return true;
  }
  if (msg.type === "collect-remove") {
    collectRemove(msg.id).then(reply);
    return true;
  }
  if (msg.type === "collect-done") {
    collectDone(tabId).then(reply);
    return true;
  }
  if (msg.type === "inbox-take") {
    inboxTake().then(reply);
    return true;
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
  // closing the tab Zero Q opened to collect from ends the round
  getCollect().then((c) => { if (c.on && c.openedTab === tabId) collectDone(undefined); });
});

// ---------- collecting photos of you from any page ----------

/** One change at a time, so two quick taps never overwrite each other. */
let collectQueue: Promise<unknown> = Promise.resolve();
const queued = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = collectQueue.then(fn, fn);
  collectQueue = run.catch(() => {});
  return run;
};
const sessionList = async (k: string) => (((await chrome.storage.session.get(k))[k] as string[] | undefined) ?? []);

async function setCollect(state: CollectState) {
  await chrome.storage.session.set({ [COLLECT_KEY]: state });
  // every open page shows or hides its tray
  for (const t of await chrome.tabs.query({})) if (t.id != null) chrome.tabs.sendMessage(t.id, { type: "collect", state } satisfies ToContent).catch(() => {});
}

function collectStart(url: string, room: number, fromTab?: number) {
  return queued(async () => {
    const tab = await chrome.tabs.create({ url, active: true, openerTabId: fromTab });
    const state: CollectState = { on: true, room: Math.max(0, room), taken: 0, returnTab: fromTab, openedTab: tab.id };
    await setCollect(state);
    return state;
  });
}

/** The photo itself, as large as the page can give it. If the file cannot be fetched, what you see on screen is used instead. */
async function readPhoto(tabId: number, src: string, rect?: Rect): Promise<Blob> {
  const url = largerImageUrl(src);
  for (const credentials of ["include", "omit"] as const) {
    try {
      const res = await fetch(url, { credentials });
      if (!res.ok) continue;
      const raw = await res.blob();
      if (!raw.type.startsWith("image/") && raw.type !== "" && raw.type !== "application/octet-stream") continue;
      return await downscale(raw, 1600);
    } catch {}
  }
  if (!rect || rect.w < 40 || rect.h < 40) throw new Error("Could not read that photo");
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "collect-veil", on: false } satisfies ToContent).catch(() => {});
  try {
    const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 92 });
    const bmp = await createImageBitmap(await (await fetch(shot)).blob());
    const k = rect.dpr || 1;
    const x = Math.max(0, Math.round(rect.x * k)), y = Math.max(0, Math.round(rect.y * k));
    const w = Math.min(bmp.width - x, Math.round(rect.w * k)), h = Math.min(bmp.height - y, Math.round(rect.h * k));
    if (w < 40 || h < 40) throw new Error("Could not read that photo");
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.drawImage(bmp, x, y, w, h, 0, 0, w, h);
    bmp.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  } finally {
    chrome.tabs.sendMessage(tabId, { type: "collect-veil", on: true } satisfies ToContent).catch(() => {});
  }
}

async function collectAdd(tabId: number, src: string, rect?: Rect, anytime = false): Promise<{ ok: boolean; id?: string; state: CollectState; full?: boolean; error?: string }> {
  const before = await getCollect();
  if (!anytime && (!before.on || before.taken >= before.room)) return { ok: false, state: before, full: before.on };
  let blob: Blob;
  try {
    blob = await readPhoto(tabId, src, rect);
  } catch (e: any) {
    return { ok: false, state: before, error: e?.message ?? "Could not read that photo" };
  }
  return queued(async () => {
    const id = ulid();
    await putBlob(inboxBlobKey(id), blob);
    const state = await getCollect();
    const next = state.on ? { ...state, taken: state.taken + 1 } : state;
    await chrome.storage.session.set({ [INBOX_KEY]: [...(await sessionList(INBOX_KEY)), id], [COLLECT_KEY]: next });
    return { ok: true, id, state: next };
  });
}

function collectRemove(id: string) {
  return queued(async () => {
    const inbox = await sessionList(INBOX_KEY);
    const state = await getCollect();
    const next = { ...state, taken: Math.max(0, state.taken - 1) };
    if (inbox.includes(id)) {
      await deleteBlob(inboxBlobKey(id));
      await chrome.storage.session.set({ [INBOX_KEY]: inbox.filter((x) => x !== id), [COLLECT_KEY]: next });
    } else {
      // already handed to setup: tell it to drop the photo
      await chrome.storage.session.set({ [GONE_KEY]: [...(await sessionList(GONE_KEY)), id], [COLLECT_KEY]: next });
    }
    return { state: next };
  });
}

function collectDone(fromTab?: number) {
  return queued(async () => {
    const state = await getCollect();
    if (!state.on) return state;
    const off: CollectState = { ...OFF, taken: state.taken };
    await setCollect(off);
    if (state.returnTab != null) {
      const back = await chrome.tabs.update(state.returnTab, { active: true }).catch(() => null);
      if (back?.windowId != null) chrome.windows.update(back.windowId, { focused: true }).catch(() => {});
      // the tab Zero Q opened has done its job
      if (back && state.openedTab != null && (fromTab == null || fromTab === state.openedTab)) chrome.tabs.remove(state.openedTab).catch(() => {});
    }
    return off;
  });
}

function inboxTake() {
  return queued(async () => {
    const ids = await sessionList(INBOX_KEY), gone = await sessionList(GONE_KEY);
    await chrome.storage.session.set({ [INBOX_KEY]: [], [GONE_KEY]: [] });
    return { ids, gone };
  });
}

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
  // The data folder is written from Zero Q's own pages, which hold the folder permission.
  if (a.name === "zq-sync") syncNow().catch(() => {});
  if (a.name === "zq-memory" && (await getSettings()).dataHome === "downloads") saveToDownloads().catch(() => {});
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
