# How Zero Q scores an item

The AI never picks the number. It reports facts about the item and answers fixed questions about you. `packages/core/src/score.ts` turns those into a score out of 100, the same way every time, and keeps a receipt of where each point came from. Tune everything in that one file; `packages/core/test/score.test.ts` checks the behaviour.

## The formula

```
score = weighted mean of the parts that apply
        + adjustments
        then capped by the strictest safety rule
```

| Part | Weight | How it is worked out | Source |
| --- | --- | --- | --- |
| Colour on you | 30% | Distance (CIE Lab ΔE) from the item's colours to your best swatches. Within 8 = 100, then minus 2 per unit. Neutrals never drop below 70. A colour within 14 of a go-easy swatch drops to 30. Main colour 75%, second colour 25%. | Measured from the hex the AI reports |
| Your style | 30% | `25 × (styleFit − 1)` + 8 per like matched (up to 2) − 25 per dislike matched (up to 2). | AI answers a 1-5 question with written anchors, and lists which of your likes and dislikes it matches |
| Shape for you | 15% | `25 × (shapeFit − 1)`. Left out when "use my build" is off. | AI answers a 1-5 question with written anchors |
| With your wardrobe | 15% | `35 + 16 × pairs` (up to 4 pairs). A look-alike at 0.85 or more loses 20; a near twin at 0.95 or more drops to 20. Left out when your wardrobe is empty. | Zero Q's existing pairing and look-alike formulas |
| Your occasions | 10% | Inside your usual dressiness range = 100, one level out = 60, two or more = 25. | AI reports dressiness 1-5 |

Parts that do not apply hand their weight to the others in proportion, so the score is always out of 100.

**Adjustments**: more than 1.5 times the top of your usual budget: minus 10.

**Safety caps** (the strictest one wins):

| Rule | Cap |
| --- | --- |
| On your never-wear list | 25 |
| You own a near twin | 40 |
| Close to a go-easy colour | 45 |

**Verdicts**: 90+ Made for you, 75-89 Good on you, 55-74 Could work, 35-54 Not quite you, under 35 Skip it.

## Anchors the AI answers against

- Style: 1 clashes with how I dress, 2 not my taste, 3 neutral, 4 clearly my taste, 5 exactly what I keep choosing.
- Shape: 1 works against my frame, 2 unflattering, 3 neutral, 4 flattering, 5 exactly the cut that suits my frame.

Requests run at temperature 0, so the same photo gives the same facts.

## Shopping a whole brand

1. Read the brand's catalogue from its own site: Shopify's `/products.json`, else the sitemap, else the product links on the page you are on. Same site only, four requests at a time, at most 120 product pages, cached for 12 hours.
2. Score every product from its text with the same formula (colour words, type, price, likes and dislikes, wardrobe). Free.
3. Send only the best 18 (six alternatives, six that go with your item, six more) to the AI with their photos, six per request, and score them properly.
4. Group them: Instead of this, To wear with it, Also for you, and Skip, you own these.
