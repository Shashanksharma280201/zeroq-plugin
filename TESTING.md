# Testing Zero Q with Gemini

About 20 minutes. You need Chrome on a laptop, a Google account and 5 photos of yourself.

## 1. Get a Gemini API key (5 min)

1. Open aistudio.google.com/apikey and sign in.
2. Click **Create API key**. Copy it (it starts with `AIza`).
3. Turn on billing for that project (AI Studio, Billing, or Google Cloud console).
   - Why: on the free tier Google may use what you send, including your photos, to improve its models, and human reviewers may see it.
   - Try-on (image editing) does not work at all on the free tier.
4. Optional: set a monthly budget alert in Google Cloud so testing can never surprise you.

## 2. Install the extension (2 min)

1. Unzip `zeroq-extension.zip` into a folder you will keep (Chrome loads it from there).
   Or from the repo: `npm install && npm run build`, then use `apps/extension/dist`.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder.
4. Pin Zero Q: puzzle icon in the toolbar, then the pin next to Zero Q.
5. A Zero Q tab opens on the **You** screen. If not, click the Zero Q icon.

Updating later: replace the folder contents and click the reload arrow on the Zero Q card.

## 3. Check the key works (1 min)

1. In the Zero Q tab: **Settings**.
2. AI for styling and ratings: **Gemini**. Paste the key.
3. Click **Test connection**. You should see *Connected* in green.
   - *rejected the key*: copy it again, no spaces.
   - *cannot use that model*: billing is not on yet.
   - *does not know the model*: Google renamed it; type the current Flash model ID in **Model**.

## 4. Build your style profile (5 min)

1. **You** tab, **Get started**.
2. Add 5 photos: head to toe, one outfit each, outfits you love. Mirror selfies are fine.
3. Tap what you shop for, your usual spend, and anything you never wear.
4. **Read my 5 outfits**. Wait about 20 seconds.
5. Check the reveal honestly:
   - Does the style name and summary sound like you?
   - Are the "Your colours" swatches colours you actually wear well?
   - Is "Go easy on" right?
   - Does the character roughly match your skin tone, hair and build?
   - Is the frame description kind and accurate? (Turn **Use my build in advice** off if you prefer.)
6. If it is off, **Redo with new photos** with clearer or more varied photos.

## 5. Add a few clothes (3 min, optional but recommended)

**Wardrobe**, **+**, add photos of 5 tops and 5 bottoms you own. Gemini names and tags each one. This powers "With what you own" in every rating.

## 6. Rate items while browsing (the main test)

Pick 10 items on any sites: 5 you would buy, 5 you would never wear.

Three ways to rate:
- **Right-click** a clothing photo, choose **Rate this for me with Zero Q**.
- Press **Alt+Shift+X**, hover any photo (it highlights), click it. Esc cancels.
- Open a product page on Myntra, Ajio, Zara, H&M etc. and click the Zero Q button bottom right. The item is scored automatically.

For each, note the score. A small card appears next to the photo; the side panel has the full read.

What good looks like:
- Your "would buy" items score 70+, your "never" items score under 55.
- The colour, shape and style notes mention *your* palette and taste, not generic praise.
- "With what you own" names real items from your wardrobe.
- It is willing to say "Not quite you" about something nice.

If it scores everything 70 to 85, it is being polite. Tell me and I will tighten the prompt.

## 7. Try it on

1. On a rated item, **Try it on**.
2. First time: **Choose a photo** of you standing, facing the camera, good light.
3. **Try it on**. Takes 5 to 15 seconds.
4. Drag across the image to compare before and after.
5. Check: is it still your face and body? Are the garment's colour and pattern right?

If Gemini changes your face or body too much, in Settings try another model (`gemini-nano-banana-2.1` or `gemini-3-pro-image`), or switch Try-on to **FASHN** with a FASHN key and compare the same item.

## 8. Compare with Claude (optional)

Settings, AI: **Claude**, paste a Claude key, rate the same 10 items again (use **Rate again**). Keep whichever is more honest about you. The profile stays; only the rater changes.

## Costs while testing (rough)

- Profile: one call with 5 photos, about a cent.
- Each rating: well under a cent on Flash.
- Each try-on: about 4 to 7 cents.

A full test like this one is well under a dollar. Prices change; check ai.google.dev/pricing.

## When something breaks

- Panel shows nothing on a page: reload the page once after installing (pages open before install do not have Zero Q).
- Right-click option missing: it only shows on images. Some sites draw products as backgrounds; use Alt+Shift+X instead.
- Errors appear in plain words in the panel and on the page card. Send me a screenshot of the panel and the site URL.
