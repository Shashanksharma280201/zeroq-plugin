/**
 * Fashion flats: a soft fill, a fine darker outline and a few construction
 * lines. Used wherever there is no photo yet: setup, ideas and empty states.
 */
export type FlatKind = "tee" | "polo" | "shirt" | "jacket" | "kurta" | "pants" | "shoe";

const mix = (a: string, b: string, k: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v * (1 - k) + y[i] * k).toString(16).padStart(2, "0")).join("")}`;
};
const light = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return (r * 299 + g * 587 + b * 114) / 1000 > 215; };

/** The quiet tile colour behind a piece: a whisper of the piece's own colour. */
export const backdropOf = (fill: string) => (light(fill) ? "var(--surface)" : `color-mix(in srgb, ${fill} 16%, var(--ground))`);

export function flatFor(category?: string, name = ""): FlatKind {
  const n = name.toLowerCase();
  if (category === "footwear") return "shoe";
  if (category === "bottom") return "pants";
  if (category === "outerwear") return "jacket";
  if (/kurta|sherwani/.test(n) || category === "one-piece") return "kurta";
  if (/polo/.test(n)) return "polo";
  if (/shirt(?!.*t-?shirt)/.test(n) && !/t-?shirt|tee/.test(n)) return "shirt";
  return "tee";
}

export function Flat({ kind, fill, label }: { kind: FlatKind; fill: string; label?: string }) {
  const o = mix(fill, "#2a2927", light(fill) ? 0.3 : 0.42);
  const a = { fill, stroke: o, strokeWidth: 1.4, strokeLinejoin: "round" as const };
  const l = { fill: "none", stroke: o, strokeWidth: 1.1, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const dots = (ys: number[]) => ys.map((y) => <circle key={y} cx="60" cy={y} r="1.2" fill={o} />);
  const body = "M44 18 L60 26 L76 18 L96 26 C101 44 105 66 107 90 L94 93 C92 76 89 60 86 48 L86 102 Q60 106 34 102 L34 48 C31 60 28 76 26 93 L13 90 C15 66 19 44 24 26 Z";
  return (
    <svg viewBox="0 0 120 120" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {kind === "tee" && (<><path d="M38 22 C44 28 52 30 60 30 C68 30 76 28 82 22 L104 34 L96 52 L86 47 L86 100 Q60 104 34 100 L34 47 L24 52 L16 34 Z" {...a} /><path d="M38 22 C44 32 52 35 60 35 C68 35 76 32 82 22 M21 45 L31 40 M99 45 L89 40" {...l} /></>)}
      {kind === "polo" && (<><path d="M38 22 L60 30 L82 22 L104 34 L96 52 L86 47 L86 100 Q60 104 34 100 L34 47 L24 52 L16 34 Z" {...a} /><path d="M46 19 L60 30 L74 19 L70 32 L60 30 L50 32 Z" {...a} /><path d="M60 30 V50 M21 45 L31 40 M99 45 L89 40" {...l} /></>)}
      {kind === "shirt" && (<><path d={body} {...a} /><path d="M44 18 L52 33 L60 26 L68 33 L76 18" {...a} /><path d="M60 26 V104 M40 47 h12 v13 q-6 3 -12 0 Z M68 47 h12 v13 q-6 3 -12 0 Z M14 85 L27 88 M106 85 L93 88" {...l} />{dots([40, 54, 68, 82])}</>)}
      {kind === "jacket" && (<><path d={body} {...a} /><path d="M44 18 L52 33 L60 26 L68 33 L76 18" {...a} /><path d="M60 26 V104 M35 58 H85 M34.5 72 H85.5 M34.5 86 H85.5 M29 44 L21 60 M91 44 L99 60 M14 85 L27 88 M106 85 L93 88" {...l} /></>)}
      {kind === "kurta" && (<><path d="M46 14 Q60 21 74 14 L94 24 C99 44 102 62 104 84 L92 87 C90 72 88 58 85 46 L88 110 H32 L35 46 C32 58 30 72 28 87 L16 84 C18 62 21 44 26 24 Z" {...a} /><path d="M46 14 Q60 24 74 14 M60 20 V54 M34 96 V110 M86 96 V110" {...l} />{dots([29, 37, 45])}</>)}
      {kind === "pants" && (<><path d="M38 12 H82 L89 106 H66 L60 44 L54 106 H31 Z" {...a} /><path d="M37.5 21 H82.5 M60 21 V40 M41 21 Q43 32 36.5 36 M79 21 Q77 32 83.5 36" {...l} /></>)}
      {kind === "shoe" && (<><path d="M12 84 H108 V90 Q108 95 103 95 H17 Q12 95 12 90 Z" fill={light(fill) ? "#e9e6df" : mix(fill, "#ffffff", 0.55)} stroke={o} strokeWidth={1.4} strokeLinejoin="round" /><path d="M14 84 C13 66 18 52 30 50 L44 47 C50 58 62 63 78 65 C93 67 104 72 106 84 Z" {...a} /><path d="M45 52 L54 48 M50 58 L60 54 M57 62 L67 59 M86 67 Q95 74 100 84 M14 70 Q24 68 30 50" {...l} /></>)}
    </svg>
  );
}
