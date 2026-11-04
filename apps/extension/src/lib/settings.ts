/**
 * Settings live in chrome.storage.local so the content script can read the
 * trigger mode without touching IndexedDB.
 */
export type TriggerMode = "auto" | "quiet" | "off";

export type AIProvider = "gemini" | "claude";
export type TryOnProvider = "gemini" | "fashn";

export interface Settings {
  /** auto: floating pill on product pages. quiet: toolbar badge only. off: shortcut only. */
  trigger: TriggerMode;
  /** Which AI reads photos, builds the profile and rates items */
  aiProvider: AIProvider;
  geminiKey: string;
  geminiModel: string;
  anthropicKey: string;
  anthropicModel: string;
  /** Which service dresses your photo */
  tryOnProvider: TryOnProvider;
  geminiImageModel: string;
  fashnKey: string;
  /** Sites where the pill never shows, e.g. "amazon.in" */
  mutedSites: string[];
  /** Set once the person has added their try-on photo */
  hasModelPhoto: boolean;
}

export const DEFAULTS: Settings = {
  trigger: "auto",
  aiProvider: "gemini",
  geminiKey: "",
  geminiModel: "gemini-3.8-flash",
  anthropicKey: "",
  anthropicModel: "claude-sonnet-5-5",
  tryOnProvider: "gemini",
  geminiImageModel: "gemini-3.1-flash-image",
  fashnKey: "",
  mutedSites: [],
  hasModelPhoto: false,
};

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get("settings");
  const saved = s.settings ?? {};
  // Saved before Gemini existed with a Claude key: keep using Claude.
  if (!saved.aiProvider && saved.anthropicKey) saved.aiProvider = "claude";
  if (!saved.tryOnProvider && saved.fashnKey) saved.tryOnProvider = "fashn";
  return { ...DEFAULTS, ...saved };
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

/** True when the chosen AI provider has a key. */
export function aiReady(s: Settings | null | undefined): boolean {
  if (!s) return false;
  return s.aiProvider === "claude" ? !!s.anthropicKey : !!s.geminiKey;
}

/** True when the chosen try-on provider has a key. Gemini try-on reuses the Gemini key. */
export function tryOnReady(s: Settings | null | undefined): boolean {
  if (!s) return false;
  return s.tryOnProvider === "fashn" ? !!s.fashnKey : !!s.geminiKey;
}

export const PROVIDER_NAME = { gemini: "Gemini", claude: "Claude" } as const;
