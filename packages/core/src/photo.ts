/**
 * Getting the best copy of a photo the user pointed at on a web page.
 * Pages show small thumbnails; these find the larger file behind them.
 */

/** The largest candidate in a srcset ("a.jpg 320w, b.jpg 1080w" or "a.jpg 1x, b.jpg 2x"). */
export function bestFromSrcset(srcset: string | null | undefined): string | undefined {
  if (!srcset) return undefined;
  let best: { url: string; size: number } | undefined;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const m = part.trim().match(/^(\S+)(?:\s+([\d.]+)([wx]))?$/);
    if (!m) continue;
    const size = m[2] ? parseFloat(m[2]) * (m[3] === "x" ? 1000 : 1) : 1;
    if (!best || size > best.size) best = { url: m[1], size };
  }
  return best?.url;
}

/**
 * Google serves every photo at any size from one address: the size sits after
 * "=" at the end (=w256-h256-no, =s220). Ask for a size worth reading.
 * Other addresses are returned as they are.
 */
export function largerImageUrl(src: string, side = 1600): string {
  let u: URL;
  try { u = new URL(src); } catch { return src; }
  if (!/(^|\.)googleusercontent\.com$|(^|\.)usercontent\.google\.com$|(^|\.)ggpht\.com$/.test(u.hostname)) return src;
  const want = `=w${side}-h${side}`;
  const path = u.pathname;
  const at = path.lastIndexOf("=");
  // only a trailing size block is replaced; a "=" inside the photo's own token is left alone
  if (at > path.lastIndexOf("/") && /^=[a-z0-9-]+$/i.test(path.slice(at)) && /^=(w|h|s)\d+/i.test(path.slice(at))) u.pathname = path.slice(0, at) + want;
  else if (at <= path.lastIndexOf("/")) u.pathname = path + want;
  else return src;
  return u.toString();
}
