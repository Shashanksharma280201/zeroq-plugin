import { useEffect, useState } from "react";
import { getBlob, onChange } from "../../lib/db.ts";
import { Icon } from "./kit.tsx";

/** Where the small picture of you is kept: a crop of one of your own outfit photos, made during setup. */
export const PORTRAIT_KEY = "me:portrait";

/**
 * You, as you are: a real photo, never a drawing. It is the face Zero Q found
 * in your photos during setup. If you set up before that existed, or your
 * photos show no face, it falls back to your first outfit photo, and then to a
 * plain icon.
 */
export function useMePhoto(): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true, made: string | undefined;
    const load = async () => {
      const b = (await getBlob(PORTRAIT_KEY)) ?? (await getBlob("outfit:0"));
      if (!live) return;
      if (made) URL.revokeObjectURL(made);
      made = b ? URL.createObjectURL(b) : undefined;
      setUrl(made);
    };
    load();
    const off = onChange(load);
    return () => { live = false; off(); if (made) URL.revokeObjectURL(made); };
  }, []);
  return url;
}

export function MePhoto({ size = 36 }: { size?: number }) {
  const url = useMePhoto();
  return (
    <span className="me-photo" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <Icon.person />}
    </span>
  );
}
