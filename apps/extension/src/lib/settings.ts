/**
 * Settings live in chrome.storage.local so the content script can read the
 * trigger mode without touching IndexedDB.
 */
export type TriggerMode = "auto" | "quiet" | "off";

export interface Settings {
  /** auto: floating pill on product pages. quiet: toolbar badge only. off: shortcut only. */
  trigger: TriggerMode;
  anthropicKey: string;
  anthropicModel: string;
  fashnKey: string;
  /** Sites where the pill never shows, e.g. "amazon.in" */
  mutedSites: string[];
  /** Set once the person has added their try-on photo */
  hasModelPhoto: boolean;
}

export const DEFAULTS: Settings = {
  trigger: "auto",
  anthropicKey: "",
  anthropicModel: "claude-sonnet-5-5",
  fashnKey: "",
  mutedSites: [],
  hasModelPhoto: false,
};

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(s.settings ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettings(fn: (s: Settings) => void): () => void {
  const h = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes.settings) fn({ ...DEFAULTS, ...changes.settings.newValue });
  };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}

export const MODEL_PHOTO_KEY = "me:photo";
