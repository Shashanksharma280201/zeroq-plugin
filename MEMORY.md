# Zero Q memory

Zero Q remembers what you do, learns what you actually like from it, and uses that to suggest things your own rules would have hidden.

Design doc: https://claude.ai/artifact/9Ygdwdygk6CKTc2YPmw9Gu

## Decisions

| Question | Decision |
| --- | --- |
| Where it syncs | Your Google Drive, in the hidden app-data folder only Zero Q can see |
| Do photos sync | Yes: wardrobe photos, outfit photos and your try-on photo |
| How long it keeps history | Forever, until you clear it in Settings |
| What counts as a purchase | Only a tap on "I bought this". Adding clothes by hand does not |

## The log

Every action is one event in IndexedDB (`events` store), never edited.

```
{ id: ULID, ts, type, payload, refs: { itemKey, brand, items }, v: 1, device }
```

| Type | Written when |
| --- | --- |
| `product_viewed` | A product page is detected (once per product per day) |
| `item_picked` | You point at or right-click an image |
| `item_rated` | A score is computed (facts, parts, caps, price, brand) |
| `rating_feedback` | You answer "Is this score right?" (too low, about right, too high, plus reasons) |
| `bought` | You tap "I bought this" |
| `brand_scanned` | "Find better" reads a brand |
| `suggestion_opened` | You open a suggested product |
| `dismissed` | You tap "Not for me" on an outside-your-usual pick |
| `tryon_run` | A try-on finishes (`kept: true` when you save the image) |
| `wardrobe_added`, `_updated`, `_removed` | Wardrobe changes (with the photo's SHA-256) |
| `outfit_suggested`, `outfit_worn` | Today plans outfits, or you wear one |
| `profile_built` | Onboarding, redo, or a profile change (with outfit photo hashes) |
| `photo_set` | You add your try-on photo |
| `notes_written`, `note_removed` | The AI writes taste notes, or you delete one |
| `setting_changed` | Trigger, providers, stretch picks or sync change. Keys and passphrases are never logged |

The first time v2 runs, it writes your existing wardrobe, profile and try-on photo into the log, so memory and sync start complete.

## The taste memory

`buildMemory()` in `packages/core/src/memory.ts` turns the whole log into one small record, rebuilt every 20 events and once a day:

- **spend**: what you paid (median, 90th percentile, most), and prices of things you loved
- **colours**: clustered by ΔE < 10, each with bought, kept in try-on, rated up, rated down, dismissed
- **categories, brands**: bought, rated, average score, opened
- **dressiness**: bought and worn by level 1 to 5; occasions worn
- **feedback**: about right, too low, too high, and which parts you disagreed with
- **scored high, not bought**: the clearest sign a limit (usually price) got in the way
- **notes**: written by the AI weekly, each citing the events it came from

`memoryBlock()` turns it into a few lines for the AI. Every rating also gets the 8 past events most like the item (`retrieveEvents()`: same item +5, brand +3, type +2, colour ΔE < 15 +2, price within 30% +1, weighted so purchases and feedback beat views). The AI is told that history beats the stated profile, except for never-wear.

## Outside your usual

`stretchFor()` re-scores an item with your soft limits relaxed where your history supports it:

```
stretch = score with relaxed limits + min(12, 4 × evidence), capped at 95
```

| Limit | Relaxed when | Evidence |
| --- | --- | --- |
| Budget | You bought or loved pieces at 80%+ of this price | each purchase 2, each loved price 1 (max 3) |
| Go-easy or off-palette colour | You bought, kept or rated up a colour within ΔE 14 | bought 2, kept 1.5, rated up 1, minus downs and dismissals |
| Occasion | You bought or wore this dressiness level | bought 2, worn 1 |
| Any of the above, with no history | The item goes with 3+ things you own | 1 (a wardrobe gap) |

Never-wear and near twins never stretch. A kind you dismiss 3+ times more than you open needs twice the evidence. A pick shows when the stretch score is 75 or more and above the normal score; at most 2 per list.

## Data folder

On Chromium browsers you choose a folder on first open (or in Settings). `lib/folder.ts` writes readable files there a few seconds after any new event while Zero Q is open, and on every open it first reads `history/*.jsonl` back in, so another browser writing to the same folder (through a cloud-synced folder) is merged: new events are inserted by id and replayed (`lib/replay.ts`) with photos read from `photos/`. Firefox, which cannot pick folders, saves `Downloads/Zero Q/zeroq-backup.json` daily with the `downloads` permission. Safari offers Back up everything.

## Sync

Files in Drive's app-data folder:

| File | Holds |
| --- | --- |
| `zq-keycheck` | Salt and an encrypted check value for the passphrase |
| `events-<device>-<first id>-<last id>.zq` | A batch of up to 500 events |
| `blob-<sha256>` | One photo, named by its content, uploaded once |

Everything except `zq-keycheck` is AES-GCM ciphertext; the key comes from your passphrase (PBKDF2, SHA-256, 310,000 rounds) and never leaves the browser.

Each sync pushes the outbox (and any photo those events need), then pulls event files it has not seen, inserts new events (ids make it idempotent) and replays them: wardrobe adds and removals, worn counts, the newest profile, photos. Then memory is rebuilt. It runs 30 seconds after new activity, every 15 minutes, and from Settings.

Sign-in uses `identity.launchWebAuthFlow` with your own OAuth client (Web application type) and the `drive.appdata` scope only. Chrome, Edge, Brave and Firefox support it; Safari does not, so sync is off there.

## Code

| File | Does |
| --- | --- |
| `packages/core/src/memory.ts` | Event types, `buildMemory`, `stretchFor`, `retrieveEvents`, `memoryBlock` (tested in `test/memory.test.ts`) |
| `apps/extension/src/lib/events.ts` | ULIDs, `logEvent`, `putEvents`, memory store, backfill, clear history |
| `apps/extension/src/lib/notes.ts` | Weekly AI taste notes |
| `apps/extension/src/lib/sync.ts` | Drive sign-in, encryption, push, pull, replay, wipe |
| `apps/extension/src/lib/platform.ts` | Side panel, sidebar or tab; `browser` vs `chrome` |
| `apps/extension/src/ui/components/MemoryView.tsx` | "What Zero Q has learned" on the You tab |
