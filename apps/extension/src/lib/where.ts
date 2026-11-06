/**
 * Where your data lives, in words you can find on your own computer.
 * Browsers never reveal real paths, so these are the standard locations
 * for each operating system and browser, with "<you>" for your user name.
 */

export type OS = "windows" | "mac" | "linux" | "chromeos";
export type BrowserName = "Chrome" | "Edge" | "Brave" | "Opera" | "Vivaldi" | "Chromium" | "Firefox" | "Safari";

export function detectOS(): OS {
  const p = ((navigator as any).userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  const ua = navigator.userAgent;
  if (p.includes("win") || /Windows/.test(ua)) return "windows";
  if (p.includes("mac") || /Mac OS X|Macintosh/.test(ua)) return "mac";
  if (p.includes("cros") || p.includes("chrome os") || /CrOS/.test(ua)) return "chromeos";
  return "linux";
}

export function detectBrowser(): BrowserName {
  const ua = navigator.userAgent;
  const brands: string[] = ((navigator as any).userAgentData?.brands ?? []).map((b: any) => b.brand);
  if ((navigator as any).brave || brands.includes("Brave")) return "Brave";
  if (/Edg\//.test(ua) || brands.includes("Microsoft Edge")) return "Edge";
  if (/OPR\//.test(ua) || brands.includes("Opera")) return "Opera";
  if (/Vivaldi/.test(ua)) return "Vivaldi";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (brands.includes("Google Chrome")) return "Chrome";
  if (brands.includes("Chromium")) return "Chromium";
  return /Chrome\//.test(ua) ? "Chrome" : "Chromium";
}

export const OS_NAME: Record<OS, string> = { windows: "Windows", mac: "macOS", linux: "Linux", chromeos: "ChromeOS" };

/** The browser profile folder that holds Zero Q's database today. */
export function browserDataPath(os: OS, browser: BrowserName, extId: string): string {
  const idb = `IndexedDB${sep(os)}chrome-extension_${extId}_0.indexeddb.leveldb`;
  const s = sep(os);
  const chromium: Record<string, Record<Exclude<OS, "chromeos">, string>> = {
    Chrome: { windows: "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default", mac: "~/Library/Application Support/Google/Chrome/Default", linux: "~/.config/google-chrome/Default" },
    Edge: { windows: "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default", mac: "~/Library/Application Support/Microsoft Edge/Default", linux: "~/.config/microsoft-edge/Default" },
    Brave: { windows: "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data\\Default", mac: "~/Library/Application Support/BraveSoftware/Brave-Browser/Default", linux: "~/.config/BraveSoftware/Brave-Browser/Default" },
    Opera: { windows: "%APPDATA%\\Opera Software\\Opera Stable", mac: "~/Library/Application Support/com.operasoftware.Opera", linux: "~/.config/opera" },
    Vivaldi: { windows: "%LOCALAPPDATA%\\Vivaldi\\User Data\\Default", mac: "~/Library/Application Support/Vivaldi/Default", linux: "~/.config/vivaldi/Default" },
    Chromium: { windows: "%LOCALAPPDATA%\\Chromium\\User Data\\Default", mac: "~/Library/Application Support/Chromium/Default", linux: "~/.config/chromium/Default" },
  };
  if (browser === "Firefox") {
    const base = { windows: "%APPDATA%\\Mozilla\\Firefox\\Profiles\\<profile>", mac: "~/Library/Application Support/Firefox/Profiles/<profile>", linux: "~/.mozilla/firefox/<profile>", chromeos: "~/.mozilla/firefox/<profile>" }[os];
    return `${base}${s}storage${s}default${s}moz-extension+++<Zero Q's id>${s}idb`;
  }
  if (browser === "Safari") return "~/Library/Containers/Zero Q Extension/Data/Library/WebKit";
  if (os === "chromeos") return "Inside ChromeOS's protected browser storage (not visible in Files)";
  return `${chromium[browser]?.[os] ?? chromium.Chrome[os]}${s}${idb}`;
}

/** Where we suggest putting the Zero Q folder. */
export function suggestedFolder(os: OS): string {
  return { windows: "C:\\Users\\<you>\\Documents\\Zero Q", mac: "/Users/<you>/Documents/Zero Q", linux: "/home/<you>/Documents/Zero Q", chromeos: "My files › Zero Q" }[os];
}

/** Where Firefox's automatic copy lands (your downloads folder, unless you changed it). */
export function downloadsFolder(os: OS): string {
  return { windows: "C:\\Users\\<you>\\Downloads\\Zero Q", mac: "/Users/<you>/Downloads/Zero Q", linux: "/home/<you>/Downloads/Zero Q", chromeos: "My files › Downloads › Zero Q" }[os];
}

/** Cloud folders on this OS that sync without any sign-in inside Zero Q. */
export function cloudFolders(os: OS): string[] {
  if (os === "mac") return ["Google Drive for desktop (~/Library/CloudStorage/GoogleDrive-…)", "iCloud Drive", "Dropbox", "OneDrive"];
  if (os === "windows") return ["Google Drive for desktop (G:\\My Drive)", "OneDrive", "Dropbox", "iCloud for Windows"];
  if (os === "chromeos") return ["Google Drive in Files"];
  return ["Dropbox", "Nextcloud", "Syncthing"];
}

/** "a, b or c" */
export const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

const sep = (os: OS) => (os === "windows" ? "\\" : "/");
