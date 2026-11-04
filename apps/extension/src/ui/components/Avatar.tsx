import { useId } from "react";
import type { Avatar as A } from "../../lib/profile.ts";

/**
 * A flat, friendly character drawn from the style profile. Always alive:
 * it breathes, blinks and sways. `mood="wave"` waves hello (used on reveal),
 * `mood="think"` tilts the head (used while rating).
 * Pass `wear` to preview an item's colour on the right part of the body.
 */
export function Avatar({ a, mood = "idle", wear, size = 220 }: { a: A; mood?: "idle" | "wave" | "think"; wear?: { category: string; hex: string }; size?: number }) {
  const id = useId().replace(/:/g, "");
  const top = wear && /top|outerwear|one-piece/.test(wear.category) ? wear.hex : a.top;
  const bottom = wear && wear.category === "bottom" ? wear.hex : wear?.category === "one-piece" ? wear.hex : a.bottom;
  const shoes = wear?.category === "footwear" ? wear.hex : a.shoes;
  const dress = wear?.category === "one-piece";

  const sw = { slim: 58, average: 66, athletic: 76, broad: 82, curvy: 64 }[a.build];
  const hip = a.build === "curvy" ? sw + 8 : sw - 8;
  const legW = a.build === "slim" ? 22 : a.build === "broad" || a.build === "athletic" ? 28 : 25;
  const hScale = { short: 0.95, average: 1, tall: 1.05 }[a.height];
  const L = 100 - sw / 2;
  const R = 100 + sw / 2;
  const topLen = a.topStyle === "kurta" || dress ? 246 : 192;
  const shade = (hex: string, amt: number) => mix(hex, amt < 0 ? "#000000" : "#ffffff", Math.abs(amt));

  return (
    <svg className={`avatar mood-${mood}`} viewBox="0 0 200 360" width={size} height={size * 1.8} role="img" aria-label="Your style character">
      <defs>
        <linearGradient id={`t${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={shade(top, 0.08)} /><stop offset="1" stopColor={shade(top, -0.12)} /></linearGradient>
        <linearGradient id={`b${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={shade(bottom, 0.05)} /><stop offset="1" stopColor={shade(bottom, -0.15)} /></linearGradient>
      </defs>
      <ellipse className="av-shadow" cx="100" cy="336" rx="52" ry="7" fill="currentColor" opacity="0.12" />
      <g className="av-body" style={{ transform: `scaleY(${hScale})` }}>
        {/* legs */}
        {a.bottomStyle === "skirt" || a.bottomStyle === "shorts" || dress ? (
          <g fill={a.skin}>
            <rect x={100 - legW - 3} y="196" width={legW - 4} height="128" rx="10" />
            <rect x={103 + 4} y="196" width={legW - 4} height="128" rx="10" />
          </g>
        ) : null}
        {!dress && (a.bottomStyle === "trousers" || a.bottomStyle === "jeans") && (
          <g fill={`url(#b${id})`}>
            <rect x={100 - legW - 2} y="186" width={legW} height="140" rx="9" />
            <rect x="102" y="186" width={legW} height="140" rx="9" />
            <rect x={100 - hip / 2} y="182" width={hip} height="30" rx="10" />
            {a.bottomStyle === "jeans" && <path d={`M${100 - legW / 2 - 2} 214 v100 M${102 + legW / 2} 214 v100`} stroke={shade(bottom, 0.25)} strokeWidth="1" strokeDasharray="3 3" />}
          </g>
        )}
        {!dress && a.bottomStyle === "shorts" && (
          <g fill={`url(#b${id})`}>
            <rect x={100 - hip / 2} y="182" width={hip} height="56" rx="10" />
          </g>
        )}
        {!dress && a.bottomStyle === "skirt" && <path d={`M${100 - hip / 2} 184 L${100 + hip / 2} 184 L${100 + hip / 2 + 16} 258 Q100 266 ${100 - hip / 2 - 16} 258 Z`} fill={`url(#b${id})`} />}
        {/* shoes */}
        <g fill={shoes}>
          <ellipse cx={100 - legW / 2 - 4} cy="328" rx={legW / 2 + 7} ry="7" />
          <ellipse cx={104 + legW / 2} cy="328" rx={legW / 2 + 7} ry="7" />
        </g>
        {/* left arm */}
        <g className="av-arm-l" style={{ transformOrigin: `${L + 4}px 108px` }}>
          <rect x={L - 12} y="104" width="15" height="92" rx="7.5" fill={a.skin} />
          <rect x={L - 12} y="104" width="15" height={a.topStyle === "tee" ? 34 : 80} rx="7.5" fill={shade(top, -0.06)} />
        </g>
        {/* torso */}
        <path
          d={`M${L + 4} 102 Q100 94 ${R - 4} 102 Q${R + 2} 104 ${R} 120 L${dress ? R + 18 : 100 + hip / 2 + 2} ${topLen} Q100 ${topLen + 6} ${dress ? L - 18 : 100 - hip / 2 - 2} ${topLen} L${L} 120 Q${L - 2} 104 ${L + 4} 102 Z`}
          fill={`url(#t${id})`}
        />
        {a.topStyle === "shirt" && !dress && <path d={`M100 104 V${topLen - 6}`} stroke={shade(top, -0.2)} strokeWidth="1" />}
        {a.topStyle === "shirt" && !dress && <path d="M90 100 L100 112 L110 100" fill="none" stroke={shade(top, 0.3)} strokeWidth="2" strokeLinejoin="round" />}
        {a.topStyle === "jacket" && !dress && (
          <path d={`M88 102 L100 140 L112 102 M100 140 V${topLen - 4}`} fill="none" stroke={shade(top, -0.25)} strokeWidth="2" strokeLinejoin="round" />
        )}
        {a.topStyle === "kurta" && !dress && <path d="M100 102 V140" stroke={shade(top, 0.35)} strokeWidth="2" />}
        {/* right arm, the one that waves */}
        <g className="av-arm-r" style={{ transformOrigin: `${R - 4}px 108px` }}>
          <rect x={R - 3} y="104" width="15" height="92" rx="7.5" fill={a.skin} />
          <rect x={R - 3} y="104" width="15" height={a.topStyle === "tee" ? 34 : 80} rx="7.5" fill={shade(top, -0.06)} />
        </g>
        {/* neck and head */}
        <rect x="92" y="84" width="16" height="18" rx="6" fill={shade(a.skin, -0.08)} />
        <g className="av-head" style={{ transformOrigin: "100px 90px" }}>
          {a.hairStyle === "long" && <path d="M66 62 Q66 28 100 28 Q134 28 134 62 L138 120 Q100 128 62 120 Z" fill={a.hair} />}
          {a.hairStyle === "covered" && <path d="M64 64 Q64 22 100 22 Q136 22 136 64 L140 104 Q100 116 60 104 Z" fill={a.hair} />}
          <circle cx="100" cy="60" r="30" fill={a.skin} />
          <ellipse cx="70" cy="62" rx="4" ry="6" fill={shade(a.skin, -0.06)} />
          <ellipse cx="130" cy="62" rx="4" ry="6" fill={shade(a.skin, -0.06)} />
          <Hair style={a.hairStyle} color={a.hair} />
          {a.facialHair !== "none" && (
            <path d="M74 62 Q76 92 100 94 Q124 92 126 62 Q122 80 100 82 Q78 80 74 62 Z" fill={a.hair} opacity={a.facialHair === "stubble" ? 0.3 : 0.92} />
          )}
          <g className="av-eyes" style={{ transformOrigin: "100px 60px" }} fill="#1d1d1f">
            <ellipse cx="89" cy="60" rx="3" ry="3.6" />
            <ellipse cx="111" cy="60" rx="3" ry="3.6" />
          </g>
          <ellipse cx="83" cy="70" rx="5" ry="3" fill="#ff7a7a" opacity="0.18" />
          <ellipse cx="117" cy="70" rx="5" ry="3" fill="#ff7a7a" opacity="0.18" />
          <path className="av-mouth" d="M92 73 Q100 79 108 73" fill="none" stroke={shade(a.skin, -0.45)} strokeWidth="2.2" strokeLinecap="round" />
          {a.glasses && (
            <g fill="none" stroke="#1d1d1f" strokeWidth="1.8">
              <circle cx="89" cy="60" r="8" />
              <circle cx="111" cy="60" r="8" />
              <path d="M97 60 h6" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

function Hair({ style, color }: { style: A["hairStyle"]; color: string }) {
  switch (style) {
    case "buzz":
      return <path d="M71 54 Q72 30 100 29 Q128 30 129 54 Q118 42 100 42 Q82 42 71 54 Z" fill={color} opacity="0.85" />;
    case "short":
      return <path d="M69 58 Q66 26 100 25 Q134 26 131 58 Q126 44 112 40 Q96 48 76 46 Q71 50 69 58 Z" fill={color} />;
    case "wavy":
      return <path d="M66 66 Q60 24 100 22 Q140 24 134 66 Q130 50 124 46 Q118 52 108 44 Q98 52 88 44 Q78 52 72 46 Q68 54 66 66 Z" fill={color} />;
    case "long":
      return <path d="M68 60 Q66 26 100 26 Q134 26 132 60 Q122 40 100 40 Q84 40 74 50 Z" fill={color} />;
    case "bun":
      return (
        <g fill={color}>
          <circle cx="100" cy="22" r="13" />
          <path d="M70 58 Q68 28 100 28 Q132 28 130 58 Q120 40 100 40 Q80 40 70 58 Z" />
        </g>
      );
    case "curly":
      return (
        <g fill={color}>
          {[[74, 44], [84, 32], [100, 27], [116, 32], [126, 44], [70, 58], [130, 58], [92, 36], [108, 36]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="11" />
          ))}
        </g>
      );
    case "covered":
      return <path d="M68 56 Q68 26 100 26 Q132 26 132 56 Q120 44 100 44 Q80 44 68 56 Z" fill={color} />;
  }
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
