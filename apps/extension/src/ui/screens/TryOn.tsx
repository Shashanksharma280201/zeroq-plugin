import { useEffect, useRef, useState } from "react";
import type { Category } from "@zq/core";
import { getBlob, putBlob } from "../../lib/db.ts";
import { downscale, srcToBlob } from "../../lib/images.ts";
import { MODEL_PHOTO_KEY, setSettings } from "../../lib/settings.ts";
import { tryOn } from "../../lib/vto.ts";
import { Icon, Sheet, useBlobUrl, useSettings } from "../components/kit.tsx";

export interface Garment {
  name: string;
  category: Category;
  /** http(s) URL of a product image */
  src?: string;
  /** blob key of a wardrobe photo */
  blobKey?: string;
}

/**
 * The reveal: your photo sits on stage, a soft scan runs while the model
 * works, then the result wipes in from the top. Drag across to compare.
 */
export function TryOnSheet({ garment, onClose }: { garment: Garment | null; onClose: () => void }) {
  const settings = useSettings();
  const [bump, setBump] = useState(0);
  const me = useBlobUrl(settings?.hasModelPhoto ? MODEL_PHOTO_KEY : undefined, bump);
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [split, setSplit] = useState<number | null>(null);
  const abort = useRef<AbortController>();
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setResult(null);
    setErr(null);
    setStatus(null);
    setSplit(null);
    return () => abort.current?.abort();
  }, [garment]);

  const savePhoto = async (f: File) => {
    await putBlob(MODEL_PHOTO_KEY, await downscale(f, 1280));
    await setSettings({ hasModelPhoto: true });
    setBump((b) => b + 1);
    setResult(null);
  };

  const run = async () => {
    if (!garment) return;
    setErr(null);
    setResult(null);
    setSplit(null);
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      setStatus("Getting ready");
      const person = await getBlob(MODEL_PHOTO_KEY);
      if (!person) throw new Error("Add a photo of yourself first.");
      const g = garment.blobKey ? await getBlob(garment.blobKey) : garment.src ? await srcToBlob(garment.src) : undefined;
      if (!g) throw new Error("Could not load the item's photo.");
      const url = await tryOn({ person, garment: g, category: garment.category, signal: abort.current.signal, onStatus: setStatus });
      // Preload so the wipe never shows a half loaded image.
      await new Promise<void>((res, rej) => { const i = new Image(); i.onload = () => res(); i.onerror = () => rej(new Error("Could not load the result.")); i.src = url; });
      setResult(url);
    } catch (e: any) {
      if (e.name !== "AbortError") setErr(e.message ?? String(e));
    } finally {
      setStatus(null);
    }
  };

  const ready = !!settings?.fashnKey && !!me;

  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!result || (e.buttons !== 1 && e.pointerType === "mouse")) return;
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };

  return (
    <Sheet open={!!garment} onClose={onClose} title="Try on">
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && savePhoto(e.target.files[0])} />

      {!me ? (
        <div className="empty" style={{ paddingTop: 24 }}>
          <div className="glyph"><Icon.person /></div>
          <h3>Add a photo of you</h3>
          <p>Standing, facing the camera, arms relaxed, good light. It stays in this browser.</p>
          <button className="btn filled small" onClick={() => pick.current?.click()}>Choose a photo</button>
        </div>
      ) : (
        <>
          <div className={`stage ${status ? "working" : ""} ${result ? "revealed" : ""}`}>
            <img src={me} alt="You" />
            {result && (
              <img className="after" src={result} alt={`You wearing ${garment?.name ?? "the item"}`}
                style={split != null ? { animation: "none", clipPath: `inset(0 0 0 ${split * 100}%)` } : undefined} />
            )}
            <div className="scan" />
            {result && <div className="compare" onPointerMove={onDrag} onPointerDown={onDrag} aria-label="Drag to compare" />}
            {split != null && <div className="compare-line" style={{ left: `${split * 100}%` }} />}
            {status && <div className="status">{status}</div>}
          </div>

          {result && <p className="note">Shows colour and shape on you. Check the fit in a trial room.</p>}
          {err && <p className="error">{err}</p>}
          {!settings?.fashnKey && <p className="hint" style={{ margin: "0 4px 16px" }}>Try-on uses FASHN. Add your FASHN API key in Settings, about $0.075 per image.</p>}

          <div className="actions two">
            <button className="btn gray" onClick={() => pick.current?.click()}>Change photo</button>
            <button className="btn filled" disabled={!ready || !!status} onClick={run}>{result ? "Try again" : status ? "Working" : "Try it on"}</button>
          </div>
          {result && <a className="btn plain" href={result} download="zeroq-tryon.png" target="_blank" rel="noreferrer" style={{ display: "flex", margin: "-16px auto 0" }}>Save image</a>}
        </>
      )}
    </Sheet>
  );
}
