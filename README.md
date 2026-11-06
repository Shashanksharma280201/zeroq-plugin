# Zero Q

A personal browser extension that brings your wardrobe to every shopping site. Runs on Chrome, Edge, Brave, Opera, Arc, Firefox and Safari.

On any product page it tells you whether the item goes with what you own, warns you when you already have something like it, and lets you try it on with your own photo. A full-page wardrobe holds your clothes and plans outfits for the day.

## Features

- **Style profile.** Show the AI 5 favourite outfits, head to toe, and answer three taps. It reads your colours, undertone, what you repeat and avoid, and (if you allow it) your frame, then draws your animated style character. Nothing about your body is asked.
- **Rate anything.** Right-click any clothing photo on any site and choose *Rate this for me*, or press `Alt+Shift+X` and click it. You get a 0 to 100 score with colour, shape and style breakdowns, what it goes with in your wardrobe, and where to wear it. A small card with the score pins next to the photo; the full read opens in the side panel. Product pages are scored automatically.

- **Product check.** Works on Myntra, Ajio, Zara, H&M, Shopify stores and most others by reading the product data stores publish for Google Shopping. No per-site code.
- **Duplicate warning.** "You have this" when the item matches something in your wardrobe by type and colour.
- **Goes with.** Things you own that pair with the item, scored on colour harmony and how dressy each piece is.
- **Stylist (optional).** With a Gemini or Claude key: a short honest take on each product, photo tagging when you add clothes, outfits for any occasion, and the gaps in your wardrobe.
- **Try-on (optional).** With Gemini (default) or FASHN: see the item on your photo, with a drag to compare. Colour and silhouette only, never fit.
- **Wardrobe.** Start with 5 tops and 5 bottoms. "I bought this" on a product page adds it with its photo.
- **Memory.** Every rating, pick, brand scan, try-on, purchase and score answer is saved in a local log, forever unless you clear it. A taste memory built from it (what you actually spend, the colours and brands you keep choosing, how you rate Zero Q's scores) goes into every AI request, and once a week the AI writes short notes on your taste that you can delete. See [MEMORY.md](MEMORY.md).
- **Outside your usual.** Budget, occasion and colour limits are soft. When your history says you would like something anyway, Zero Q shows it, at most 2 per list, with the reason ("over your usual budget, but you have bought 2 pieces near this price") and a "Not for me" button. Never-wear stays hard. Turn it off in Settings.
- **Is this score right?** Tap too low, about right or too high under any score, and say why. It teaches the memory.
- **Rated history.** Every item you rate, with its photo, score, site and date, on the You tab. Filter by 75 and up, under 55, or bought.
- **Your data folder.** The first time it opens, Zero Q asks where to keep your data and shows where it sits today. On Chrome, Edge, Brave, Opera and Arc you pick a folder (suggested: `Documents/Zero Q`) and Zero Q keeps readable files there: profile, wardrobe, rated items with photos, full history. Put it inside Google Drive for desktop, iCloud Drive, Dropbox or OneDrive and your browsers share it with no sign-in. Firefox saves a daily backup to `Downloads/Zero Q`; Safari offers a backup file.
- **Google Drive sync (optional).** History, wardrobe, profile and photos go to a hidden folder in your own Drive, encrypted with a passphrase, so every browser you use has the same Zero Q.

## How it shows up

| Setting | On product pages |
| --- | --- |
| Button (default) | A small floating button with what Zero Q found. Click to open the side panel. Hide per page or per site. |
| Badge only | Nothing on the page. The toolbar icon shows a number for matches, `!` for a duplicate. |
| Shortcut only | Zero Q checks a page only when you open it. |

`Alt+Shift+Z` or the toolbar icon opens the side panel on any page. `Alt+Shift+X` starts point-and-rate. Change the shortcut at `chrome://extensions/shortcuts`.

Chrome does not let extensions open the side panel without a click or a key press, so "auto" means the button appears on its own, not the panel.

## Install

```bash
npm install
npm run build:all     # or build, build:firefox, build:safari
```

| Browser | Build | Install | Panel |
| --- | --- | --- | --- |
| Chrome, Edge, Brave, Opera, Arc | `apps/extension/dist` | Extensions page, Developer mode, **Load unpacked** | Side panel (Chrome, Edge, Brave); a tab on Opera and Arc |
| Firefox 128+ | `apps/extension/dist-firefox` | `about:debugging`, This Firefox, **Load Temporary Add-on**, pick `manifest.json` (stays until restart). To keep it, sign it as unlisted on addons.mozilla.org, or use Firefox Developer Edition with `xpinstall.signatures.required` off | Sidebar |
| Safari 17+ (Mac) | `apps/extension/dist-safari` | `xcrun safari-web-extension-converter apps/extension/dist-safari --app-name "Zero Q"`, run the app from Xcode, then enable it in Safari, Settings, Extensions (allow unsigned extensions in the Develop menu) | A tab next to the shop |

Chrome stays in `dist/` on purpose: an unpacked extension's ID comes from its folder, and your data lives under that ID.

On Firefox, give Zero Q access to all sites when asked (or in the add-on's Permissions tab); without it, product pages are not read. Safari asks per site the first time.

For development, `npm run dev` rebuilds the Chrome build on save; click the reload icon on the extension card after changes to the background or content script.

## Keys and providers

All keys are optional and live only in this browser's extension storage. Each is sent only to its own provider. Pick providers in Settings.

| Job | Default | Alternative |
| --- | --- | --- |
| Profile, ratings, tagging, outfits | Gemini `gemini-3.8-flash` | Claude `claude-sonnet-5-5` |
| Try-on | Gemini `gemini-3.1-flash-image` (same key) | FASHN `tryon-v1.6` |

- Gemini: aistudio.google.com/apikey. Turn on billing; on the free tier Google may use inputs for training, and image editing is paid only.
- Claude: console.anthropic.com.
- FASHN: app.fashn.ai.

Model IDs are editable in Settings because providers rename them. See [TESTING.md](TESTING.md) for a step-by-step test.

## Data

Everything is stored in IndexedDB in your browser profile: wardrobe, photos, profile, the event log and the taste memory. Nothing leaves the browser except what you send to your AI and try-on providers, and, if you turn it on, encrypted files in your own Google Drive.

**Where it is on disk.** Settings, Where your data lives shows the exact path for your browser and OS, for example:

| OS | Chrome's database | Suggested Zero Q folder |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB\chrome-extension_<id>_0.indexeddb.leveldb` | `C:\Users\<you>\Documents\Zero Q` |
| macOS | `~/Library/Application Support/Google/Chrome/Default/IndexedDB/…` | `/Users/<you>/Documents/Zero Q` |
| Linux | `~/.config/google-chrome/Default/IndexedDB/…` | `/home/<you>/Documents/Zero Q` |

The browser database is not readable by hand; the folder is. Its layout: `profile.json`, `wardrobe.json`, `rated.json`, `memory.json`, `settings.json` (no keys), `history/YYYY-MM.jsonl` (every event), `photos/wardrobe`, `photos/outfits`, `photos/rated`, `photos/me.jpg`. Chrome may ask again for folder access after a restart; Zero Q shows an Allow button when it does.

**Drive sync** needs a free OAuth client ID from Google Cloud (Settings shows the steps and the exact redirect URL to add). Use the same client ID and passphrase in each browser, and add each browser's redirect URL to the client. Safari cannot sign in to Google from an extension, so sync is off there; use **Back up everything** and **Restore** to move data in or out.

**Back up everything** saves one JSON file with your wardrobe, profile, photos and full history.

## Layout

```
packages/core       product detection, matching, the score formula, memory and stretch maths (tested)
apps/extension
  src/content.ts    runs on pages, detects products, shows the floating button
  src/background.ts badge, panel, per-tab state, memory and sync alarms
  src/lib/          IndexedDB, event log, Drive sync, settings, AI clients, platform shims
  build.mjs         one source, three builds: Chrome family, Firefox, Safari
  src/ui/           React UI shared by the side panel and the full-page wardrobe
```

```bash
npm test         # core tests
npm run typecheck
```
