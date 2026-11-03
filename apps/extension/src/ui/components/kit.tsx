import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { WardrobeItem } from "@zq/core";
import { getBlob, listItems, onChange } from "../../lib/db.ts";
import { getSettings, onSettings, type Settings } from "../../lib/settings.ts";

// ---------- icons (drawn to sit next to SF Symbols) ----------

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  tag: () => (<svg viewBox="0 0 24 24" {...s}><path d="M3.5 12.6V4.8c0-.7.6-1.3 1.3-1.3h7.8c.35 0 .68.14.92.38l7.4 7.4a1.3 1.3 0 0 1 0 1.84l-7.8 7.8a1.3 1.3 0 0 1-1.84 0l-7.4-7.4a1.3 1.3 0 0 1-.38-.92Z"/><circle cx="8.2" cy="8.2" r="1.4"/></svg>),
  sun: () => (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2M12 19.2v2M4.6 4.6 6 6M18 18l1.4 1.4M2.8 12h2M19.2 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>),
  hanger: () => (<svg viewBox="0 0 24 24" {...s}><path d="M12 8.2V7.6a2.1 2.1 0 1 0-2.1-2.1"/><path d="M12 8.2 3.4 15.4c-.8.67-.33 1.98.72 1.98h15.76c1.05 0 1.52-1.31.72-1.98L12 8.2Z"/></svg>),
  gear: () => (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-1.9-3.3-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14.1 2.6h-3.8l-.4 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-1.9 3.3 1.9 1.5a7.6 7.6 0 0 0 0 3l-1.9 1.5 1.9 3.3 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h3.8l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 1.9-3.3-1.9-1.5Z"/></svg>),
  plus: () => (<svg viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M12 5v14M5 12h14"/></svg>),
  check: () => (<svg viewBox="0 0 24 24" {...s} strokeWidth={2.2}><circle cx="12" cy="12" r="9.5" strokeWidth={1.7}/><path d="m8 12.3 2.7 2.7L16.2 9.5"/></svg>),
  alert: () => (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg>),
  person: () => (<svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.2c.9-3.7 3.6-5.6 7.2-5.6s6.3 1.9 7.2 5.6"/></svg>),
  expand: () => (<svg viewBox="0 0 24 24" {...s}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>),
  sparkle: () => (<svg viewBox="0 0 24 24" {...s}><path d="M12 3.5c.5 4.3 2.2 6 6.5 6.5-4.3.5-6 2.2-6.5 6.5-.5-4.3-2.2-6-6.5-6.5 4.3-.5 6-2.2 6.5-6.5Z"/><path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z"/></svg>),
  search: () => (<svg viewBox="0 0 24 24" {...s} width={16} height={16}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg>),
  bag: () => (<svg viewBox="0 0 24 24" {...s}><path d="M5 8h14l-1 12.2a1 1 0 0 1-1 .8H7a1 1 0 0 1-1-.8L5 8Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/></svg>),
};

// ---------- data hooks ----------

export function useWardrobe(): WardrobeItem[] | null {
  const [items, setItems] = useState<WardrobeItem[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => listItems().then((i) => live && setItems(i));
    load();
    const off = onChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return items;
}

export function useSettings(): Settings | null {
  const [st, set] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(set);
    return onSettings(set);
  }, []);
  return st;
}

/** Object URL for a stored blob, revoked on unmount. */
export function useBlobUrl(key?: string, bump = 0): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!key) return setUrl(undefined);
    let u: string | undefined;
    let live = true;
    getBlob(key).then((b) => {
      if (!b || !live) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [key, bump]);
  return url;
}

export function ItemImg({ item, className }: { item: WardrobeItem; className?: string }) {
  const url = useBlobUrl(item.image);
  return url ? <img src={url} alt="" className={className} loading="lazy" draggable={false} /> : <div className={`${className ?? ""} ph`} aria-hidden />;
}

/** Run a state change inside a View Transition when the browser supports it. */
export function transition(fn: () => void) {
  const d = document as any;
  if (!d.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return fn();
  d.startViewTransition(() => flushSync(fn));
}

// ---------- page with large title ----------

export function Page({ title, subtitle, trailing, children }: { title: string; subtitle?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div className={`navbar ${scrolled ? "scrolled" : ""}`}>
        <span />
        <span className="small-title" aria-hidden={!scrolled}>{title}</span>
        <span className="trail">{trailing}</span>
      </div>
      <div className="content">
        <h1 className="large-title">{title}</h1>
        <div ref={sentinel} style={{ height: 1, marginTop: -17 }} />
        {subtitle && <p className="subtitle" style={{ marginTop: 6 }}>{subtitle}</p>}
        {children}
      </div>
    </>
  );
}

// ---------- segmented control with a sliding thumb ----------

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <span className="seg-thumb" style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

// ---------- sheet: springs up, drag down to dismiss ----------

export function Sheet({ open, onClose, title, right, children }: { open: boolean; onClose: () => void; title?: string; right?: ReactNode; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    } else if (mounted) {
      setShown(false);
      const t = setTimeout(() => setMounted(false), 420);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);

  const down = useCallback((e: React.PointerEvent) => {
    if (innerWidth >= 760) return;
    drag.current = { y: e.clientY, dy: 0, t: performance.now() };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ref.current?.classList.add("dragging");
  }, []);
  const move = useCallback((e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const dy = e.clientY - drag.current.y;
    // rubber band upwards, free downwards
    drag.current.dy = dy > 0 ? dy : dy / 6;
    ref.current.style.setProperty("--drag", `${drag.current.dy}px`);
  }, []);
  const up = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d || !el) return;
    el.classList.remove("dragging");
    const v = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 120 || v > 0.6) onClose();
    el.style.setProperty("--drag", "0px");
  }, [onClose]);

  if (!mounted) return null;
  return (
    <>
      <div className={`backdrop ${shown ? "on" : ""}`} onClick={onClose} />
      <div ref={ref} className={`sheet ${shown ? "on" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="grabber" />
          <div className="sheet-bar">
            <button className="btn plain" onClick={onClose} style={{ justifySelf: "start" }}>Close</button>
            <span className="t">{title}</span>
            <span className="r">{right}</span>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

// ---------- HUD ----------

type Hud = (text: string, kind?: "ok" | "err") => void;
const HudCtx = createContext<Hud>(() => {});
export const useHud = () => useContext(HudCtx);

export function HudProvider({ children }: { children: ReactNode }) {
  const [h, setH] = useState<{ text: string; kind: "ok" | "err"; on: boolean }>({ text: "", kind: "ok", on: false });
  const timer = useRef<number>();
  const show = useCallback<Hud>((text, kind = "ok") => {
    clearTimeout(timer.current);
    setH({ text, kind, on: true });
    timer.current = window.setTimeout(() => setH((x) => ({ ...x, on: false })), 2200);
  }, []);
  return (
    <HudCtx.Provider value={show}>
      {children}
      <div className={`hud ${h.on ? "on" : ""} ${h.kind === "err" ? "err" : ""}`} role="status" aria-live="polite">
        {h.kind === "err" ? <Icon.alert /> : <Icon.check />}
        {h.text}
      </div>
    </HudCtx.Provider>
  );
}

export function money(n?: number, c?: string): string {
  if (n == null) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: c || "INR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${c ?? ""} ${n}`.trim();
  }
}
