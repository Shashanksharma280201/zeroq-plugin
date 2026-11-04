# Zero Q

A personal Chrome extension that brings your wardrobe to every shopping site.

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
npm run build
```

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose `apps/extension/dist`.

For development, `npm run dev` rebuilds on save; click the reload icon on the extension card after changes to the background or content script.

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

Everything is stored in IndexedDB in your Chrome profile. Nothing syncs. Use Settings, Back up wardrobe before removing the extension or moving machines.

## Layout

```
packages/core       product detection, classification, matching, outfits (tested)
apps/extension
  src/content.ts    runs on pages, detects products, shows the floating button
  src/background.ts badge, side panel, per-tab product state
  src/lib/          IndexedDB, settings, Claude client, FASHN client, image helpers
  src/ui/           React UI shared by the side panel and the full-page wardrobe
```

```bash
npm test         # core tests
npm run typecheck
```
