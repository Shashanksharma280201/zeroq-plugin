import { detectProduct } from "@zq/core";

/**
 * The other photos of the same product, so the stylist sees every angle,
 * not just the one you clicked. On a product page that is the product's
 * gallery; on a listing it is the other pictures inside the same product
 * card (stores keep a back or worn view there for hover).
 */
const MAX = 4;
const path = (u: string) => { try { const x = new URL(u, location.href); return x.origin + x.pathname; } catch { return u; } };

function biggestFromSrcset(set: string | null): string | null {
  if (!set) return null;
  const parts = set.split(",").map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
  parts.sort((a, b) => (parseFloat(b[1] ?? "0") || 0) - (parseFloat(a[1] ?? "0") || 0));
  return parts[0]?.[0] ?? null;
}

function urlsOf(img: HTMLImageElement): string[] {
  const out = [img.currentSrc, img.src, img.getAttribute("data-src"), img.getAttribute("data-original"), biggestFromSrcset(img.getAttribute("srcset")), biggestFromSrcset(img.getAttribute("data-srcset"))];
  return out.filter((u): u is string => !!u && !u.startsWith("data:")).map((u) => new URL(u, location.href).href);
}

export function relatedImages(src: string, el?: Element | null): string[] {
  const me = path(src);
  const out: string[] = [src];
  const add = (u: string) => {
    if (out.length >= MAX || out.some((x) => path(x) === path(u))) return;
    if (/sprite|logo|icon|placeholder|blank\.gif/i.test(u)) return;
    out.push(u);
  };

  // 1. A product page whose gallery holds this photo, or one main product
  const p = detectProduct(document, location.href);
  if (p && p.images.length > 1 && (p.images.some((u) => path(u) === me) || !el)) {
    p.images.forEach(add);
    return out;
  }

  // 2. The product card around the clicked photo
  el ??= Array.from(document.images).find((i) => urlsOf(i).some((u) => path(u) === me)) ?? null;
  let node: Element | null = el;
  for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
    const imgs = Array.from(node.querySelectorAll("img"));
    if (imgs.length < 2) continue;
    if (imgs.length > 8) break; // climbed past the card into the whole grid
    const links = new Set([...(node.matches("a[href]") ? [node] : []), ...node.querySelectorAll("a[href]")].map((a) => path((a as HTMLAnchorElement).href)));
    if (links.size > 1) break; // more than one product: this is the grid, not the card
    if (links.size === 0 && depth < 6) continue;
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      // hidden hover images count (they are the other angles); tiny swatches do not
      const tiny = r.width > 0 && r.width < 80 && r.height < 80;
      if (!tiny) urlsOf(img).slice(0, 1).forEach(add);
    }
    break;
  }
  return out;
}
