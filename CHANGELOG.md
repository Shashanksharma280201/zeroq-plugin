# Changelog

## 0.5.1 (2026-11-10)

- Google Photos by permission. The option is always shown in setup. Zero Q first says what Google will ask and what it will see, then opens Google's permission screen, then the Google Photos picker. It gets only the photos you pick.
- Once connected it does not ask again: the permission is renewed quietly. Me has a Google Photos section to connect or disconnect; disconnecting revokes the permission at Google.
- Firefox now uses the redirect address Google accepts, so Google sign-in (Photos and Drive) can work there.
- Zero Q can carry its own Google client ID (apps/extension/google.json). When it is filled in, the Chrome build gets a fixed extension ID so one registration works for every user. Until then nothing changes for current installs. Steps in docs/google-photos.md.

## 0.5.0 (2026-11-10)

- New look, calm and soft: a milk ground with sage, butter, blush and lavender tints, Fraunces for answers and Figtree for everything else. Seven type sizes, none under 12. Pills for everything you tap. Light and dark.
- Every answer is now one of three: Buy it, Sleep on it, Skip it, with up to four picture facts (your style, your colour, budget, what it goes with) instead of a paragraph. The full reasoning sits behind "Why 91?".
- Reads the whole product page: sizes and which are sold out, the crossed-out price and discount, fabric, fit, care, buyer rating and reviews, spec rows and the product's own text. All of it goes to the AI with every photo.
- Better analysis from that data: whether your size is in stock, sizing advice from reviews, fabric feel and season, what buyers say, and whether the price is fair. Buyer ratings nudge the score a little when at least 20 people have rated.
- New: "New at stores you visit" in Explore. Zero Q goes back to the stores in your history, leaves out everything you have seen or own, and shows new pieces as complete outfits with your wardrobe and the pieces you searched and liked. It takes a minute or two; the result is kept for a day.
- Setup is now a full page that opens when you install: connect, photos, taste, your label. It asks for the looks you would wear and your usual sizes. The same screens stack in the side panel.
- The typefaces now include a real rupee sign.

## 0.4.0 (2026-11-09)

- Every angle: when you rate a product, Zero Q now sends up to 4 photos of it (front, back, worn, detail), not just the one you clicked. On a product page it reads the store's gallery; on a listing it takes the other photos inside that product's card, including the back view stores show on hover.
- Fixed: pointing at a listing card could grab the hidden hover photo instead of the one you see.
- New: Explore. A card on Searched opens ideas that are new for you, chosen from what you search and what you own: a colour you never wear, a kind of piece you never try, one thing worth going over your usual budget, and a new occasion. Each idea links straight to a search on Myntra, Ajio, Amazon and Flipkart.
- New: on a brand's own site, "Look through" scans its catalogue for pieces that are new for you but still suit you, tagged by why they are new.

## 0.3.1 (2026-11-09)

- Fixed: the panel could go blank after updating to 0.3.0. The new top bar draws your character on every screen, and a profile saved by an early version (or a cut-off AI answer) without character data crashed it. Profiles are now filled in with safe defaults when they load.
- New: if any screen ever crashes, Zero Q shows "Something went wrong" with Reload and Copy details, never an empty panel.

## 0.3.0 (2026-11-09)

- **Two tabs.** *Searched*: everything you asked Zero Q about, each shown as a picture equation, the item = the best outfit from your wardrobe (✦ when your stylist picked it). *Wardrobe*: everything you own, each with its best outfit, plus an Outfits view for today. Tap a row for the outfit laid out, with Open, I bought it (moves it to Wardrobe) and Remove.
- On a shop page, a *Now viewing* card opens the "Should I buy this?" answer; a right-click or point opens it straight away. Profile and settings live behind your avatar.
- **Onboarding photos from anywhere:** Google Photos (pick inside Google Photos, tip: search "me"), uploads, and group photos where you tap yourself and Zero Q crops to you. 3 to 20 photos.
- AI key comes first in onboarding, so photos can be checked as they arrive.

## 0.2.1 (2026-11-07)

- Fixed: onboarding could fail with "JSON.parse: end of data after property value" (Firefox) or "Unexpected end of JSON input" (Chrome) when the AI's answer hit its length limit. Zero Q now spots a cut-off answer from Claude or Gemini and asks once more with three times the room.
- Longer limits for the style profile (4,000 tokens), ratings, brand batches, outfit plans and taste notes.
- If an answer is ever incomplete, the message now says so in plain words.

## 0.2.0 (2026-11-06)

Zero Q is a personal shopping companion for your browser. It rates any clothing item on any site against your style, checks it against your wardrobe, lets you try it on, and now remembers what you actually buy so its suggestions get better.

### Downloads
| File | For | Install |
| --- | --- | --- |
| `zeroq-0.2.0-chrome.zip` | Chrome, Edge, Brave, Opera, Arc | Unzip. Open the extensions page, turn on Developer mode, click **Load unpacked** and pick the folder. To update, unzip over the same folder and reload, so your data stays. |
| `zeroq-0.2.0-firefox.zip` | Firefox 128+ | `about:debugging` → This Firefox → **Load Temporary Add-on** → `manifest.json`. It stays until you restart Firefox. |
| `zeroq-0.2.0-safari.zip` | Safari 17+ on a Mac | Unzip, then run `xcrun safari-web-extension-converter <folder> --app-name "Zero Q"`, run the app from Xcode, and enable it in Safari Settings → Extensions. |

### New in 0.2.0
- **Memory.** Every rating, purchase, try-on, brand scan and score answer is saved. The AI sees what you really spend, the colours and brands you keep choosing, and the 8 past items most like the one you're looking at.
- **Is this score right?** Answer too low, about right or too high under any score, and say why.
- **Outside your usual.** Up to 2 picks per list that break your budget, occasion or colour limits when your history says you'd like them, each with its reason. Never-wear items stay off limits.
- **Taste notes.** Once a week the AI writes short notes on your taste, and you can delete any of them.
- **Rated history.** Every item you rated, with its photo and score, on the You tab.
- **Your data folder.** On first open Zero Q shows where your data is stored and lets you choose a folder for readable files (suggested: `Documents/Zero Q`). Put it inside a cloud folder to back it up. Firefox saves a daily backup to `Downloads/Zero Q`.
- **Google Drive sync (optional).** Encrypted with your passphrase, photos included. Needs your own OAuth client ID. Not available on Safari.
- **Every browser.** The same features on Chrome, Edge, Brave, Opera, Arc, Firefox and Safari.

### Also included
- Style profile from 5 outfit photos, with an animated character.
- Point-and-rate: right-click any photo, or press `Alt+Shift+X` and click it. The score comes from a fixed formula built from facts the AI reports.
- **Find better on this brand:** reads the brand's whole site and ranks every product for you.
- Duplicate warnings, pairings, outfits for the day, and try-on with Gemini or FASHN.

### Known limits
- Firefox builds pass Mozilla's linter but haven't been tested in a live Firefox. Without signing they load only until Firefox restarts.
- The Safari build has to be converted on a Mac with Xcode.
- Drive sync and the folder picker were tested against mocks, not a real Google account or a real folder dialog.

See README.md, MEMORY.md and TESTING.md for details.

## 0.1.0

First build: product check, wardrobe, outfits, try-on, style profile, point-and-rate, score formula, brand shopping, Lookbook design.
