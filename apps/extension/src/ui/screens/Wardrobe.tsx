import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, guessColors, guessKind, type Category, type WardrobeItem } from "@zq/core";
import { tagPhoto } from "../../lib/ai.ts";
import { addItem, deleteItem, updateItem } from "../../lib/db.ts";
import { canTryOn } from "../../lib/vto.ts";
import { Icon, ItemImg, Page, Segmented, Sheet, transition, useBlobUrl, useHud, useSettings } from "../components/kit.tsx";

type Filter = "all" | "top" | "bottom" | "outerwear" | "footwear" | "more";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "top", label: "Tops" },
  { value: "bottom", label: "Bottoms" },
  { value: "outerwear", label: "Layers" },
  { value: "footwear", label: "Shoes" },
  { value: "more", label: "More" },
];
const CAT_LABEL: Record<Category, string> = { top: "Top", bottom: "Bottom", "one-piece": "One piece", outerwear: "Layer", footwear: "Shoes", accessory: "Accessory", other: "Other" };

export function Wardrobe({ wardrobe, onTryOn }: { wardrobe: WardrobeItem[]; onTryOn: (item: WardrobeItem) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(location.hash === "#add");
  const [open, setOpen] = useState<WardrobeItem | null>(null);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return wardrobe.filter((i) => {
      const f = filter === "all" || (filter === "more" ? ["one-piece", "accessory", "other"].includes(i.category) : i.category === filter);
      const m = !ql || `${i.name} ${i.brand ?? ""} ${i.colors.join(" ")} ${i.kind ?? ""}`.toLowerCase().includes(ql);
      return f && m;
    });
  }, [wardrobe, filter, q]);

  const tops = wardrobe.filter((i) => i.category === "top").length;
  const bottoms = wardrobe.filter((i) => i.category === "bottom").length;

  return (
    <Page
      title="Wardrobe"
      subtitle={wardrobe.length ? `${wardrobe.length} ${wardrobe.length === 1 ? "piece" : "pieces"}` : undefined}
      trailing={<button className="icon-btn" aria-label="Add clothes" onClick={() => setAdding(true)}><Icon.plus /></button>}
    >
      {(tops < 5 || bottoms < 5) && (
        <section className="ladder">
          <h3>{wardrobe.length === 0 ? "Start with your 10 favourites" : "Almost there"}</h3>
          <p>5 tops and 5 bottoms you wear the most. That is enough for real outfits and honest duplicate checks. Add the rest only when you feel like it.</p>
          <div className="bars">
            <div><div className="bar-l"><span>Tops</span><span>{Math.min(tops, 5)} of 5</span></div><div className="track"><i style={{ transform: `scaleX(${Math.min(1, tops / 5)})` }} /></div></div>
            <div><div className="bar-l"><span>Bottoms</span><span>{Math.min(bottoms, 5)} of 5</span></div><div className="track"><i style={{ transform: `scaleX(${Math.min(1, bottoms / 5)})` }} /></div></div>
          </div>
          <button className="btn filled small" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>Add photos</button>
        </section>
      )}

      {wardrobe.length > 0 && (
        <>
          <label className="search">
            <Icon.search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search wardrobe" />
          </label>
          <Segmented label="Category" options={FILTERS} value={filter} onChange={(v) => transition(() => setFilter(v))} />
          {shown.length === 0 ? (
            <div className="empty"><h3>Nothing here yet</h3><p>Try another category or search.</p></div>
          ) : (
            <div className="grid">
              {shown.map((i) => (
                <button className="tile" key={i.id} onClick={() => setOpen(i)} style={{ viewTransitionName: `it-${i.id}` } as any}>
                  <div className="img"><ItemImg item={i} /></div>
                  <div className="name truncate">{i.name}</div>
                  <div className="sub truncate">{i.wornCount ? `Worn ${i.wornCount}×` : i.brand ?? CAT_LABEL[i.category]}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <AddSheet open={adding} onClose={() => setAdding(false)} defaultCategory={filter === "all" || filter === "more" ? undefined : filter} />
      <ItemSheet item={open} onClose={() => setOpen(null)} onTryOn={(i) => { setOpen(null); onTryOn(i); }} />
    </Page>
  );
}

// ---------- adding photos ----------

interface Draft {
  key: string;
  file: File;
  url: string;
  status: "tagging" | "ready" | "saving";
  name: string;
  category: Category;
  kind?: string;
  colors: string[];
  formality: number;
}

function AddSheet({ open, onClose, defaultCategory }: { open: boolean; onClose: () => void; defaultCategory?: Category }) {
  const settings = useSettings();
  const hud = useHud();
  const input = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!open) {
      drafts.forEach((d) => URL.revokeObjectURL(d.url));
      setDrafts([]);
    }
  }, [open]);

  const patch = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const take = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 12);
    const fresh: Draft[] = list.map((file) => {
      const base = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
      const k = guessKind(base);
      return {
        key: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        status: settings?.anthropicKey ? "tagging" : "ready",
        name: /^(img|dsc|pxl|photo|image|screenshot)/i.test(base) ? "" : base,
        category: k.category !== "other" ? k.category : defaultCategory ?? "top",
        kind: k.kind,
        colors: guessColors(base),
        formality: k.formality,
      };
    });
    setDrafts((d) => [...d, ...fresh]);
    if (!settings?.anthropicKey) return;
    // Tag a few at a time so the first results land quickly.
    const queue = [...fresh];
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        try {
          const t = await tagPhoto(d.file);
          patch(d.key, { ...t, status: "ready" });
        } catch (e: any) {
          patch(d.key, { status: "ready" });
          hud(e.message ?? "Could not read a photo", "err");
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  const save = async () => {
    const ready = drafts.filter((d) => d.status === "ready");
    for (const d of ready) {
      patch(d.key, { status: "saving" });
      await addItem({
        name: d.name.trim() || `${d.colors[0] ? d.colors[0][0].toUpperCase() + d.colors[0].slice(1) + " " : ""}${d.kind ?? CAT_LABEL[d.category].toLowerCase()}`,
        category: d.category,
        kind: d.kind,
        colors: d.colors,
        formality: d.formality,
        imageSrc: d.url,
        source: "upload",
      });
    }
    hud(ready.length === 1 ? "Added 1 piece" : `Added ${ready.length} pieces`);
    onClose();
  };

  const busy = drafts.some((d) => d.status !== "ready");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add clothes"
      right={drafts.length > 0 && <button className="btn plain" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Add {drafts.length}</button>}
    >
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && take(e.target.files)} />
      <div
        className="group"
        style={{ padding: 24, textAlign: "center", outline: over ? "2px dashed var(--tint)" : "none", transition: "outline .2s" }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      >
        <p style={{ margin: "0 0 14px", color: "var(--label-2)" }}>One item per photo, on a bed or a hanger, in daylight. Drop photos here or choose them.</p>
        <button className="btn filled small" onClick={() => input.current?.click()}>Choose photos</button>
      </div>
      {settings && !settings.anthropicKey && drafts.length > 0 && (
        <p className="hint" style={{ margin: "-12px 4px 16px" }}>Without an Anthropic key, check the type and colour of each one yourself.</p>
      )}
      {drafts.length > 0 && (
        <div className="group">
          {drafts.map((d) => (
            <div className="row thumb-row" key={d.key} style={{ alignItems: "flex-start", paddingTop: 12, paddingBottom: 12 }}>
              <img className="thumb" src={d.url} alt="" style={{ width: 56, height: 72 }} />
              <div className="grow" style={{ display: "grid", gap: 6 }}>
                {d.status === "tagging" ? (
                  <><div className="shimmer" style={{ width: "70%" }} /><div className="shimmer" style={{ width: "40%" }} /></>
                ) : (
                  <>
                    <input className="field" style={{ padding: 0, minHeight: 24, fontWeight: 500 }} value={d.name} placeholder="Name, like Navy oxford shirt" onChange={(e) => patch(d.key, { name: e.target.value })} aria-label="Name" />
                    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--label-2)", fontSize: 13 }}>
                      <select className="field" style={{ padding: 0, minHeight: 22, textAlign: "left", width: "auto" }} value={d.category} onChange={(e) => patch(d.key, { category: e.target.value as Category })} aria-label="Type">
                        {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                      </select>
                      <input className="field" style={{ padding: 0, minHeight: 22, fontSize: 13 }} value={d.colors.join(", ")} placeholder="colours" onChange={(e) => patch(d.key, { colors: e.target.value.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) })} aria-label="Colours" />
                    </div>
                  </>
                )}
              </div>
              <button className="icon-btn" aria-label="Remove" style={{ color: "var(--label-3)" }} onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ---------- one item ----------

function ItemSheet({ item, onClose, onTryOn }: { item: WardrobeItem | null; onClose: () => void; onTryOn: (i: WardrobeItem) => void }) {
  const hud = useHud();
  const [it, setIt] = useState<WardrobeItem | null>(item);
  useEffect(() => { if (item) setIt(item); }, [item]);
  const url = useBlobUrl(it?.image);
  if (!it) return null;
  const set = (p: Partial<WardrobeItem>) => {
    setIt({ ...it, ...p });
    updateItem(it.id, p);
  };
  return (
    <Sheet open={!!item} onClose={onClose} title={CAT_LABEL[it.category]}>
      <div className="stage" style={{ aspectRatio: "4 / 5" }}>{url && <img src={url} alt="" />}</div>
      <div className="group">
        <div className="row"><input className="field" style={{ padding: 0, fontWeight: 600, fontSize: 17 }} value={it.name} onChange={(e) => set({ name: e.target.value })} aria-label="Name" /></div>
        <div className="row"><span className="grow">Type</span>
          <select className="field" style={{ width: "auto" }} value={it.category} onChange={(e) => set({ category: e.target.value as Category })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="row"><span className="grow">Colours</span>
          <input className="field" style={{ textAlign: "right", width: "55%", padding: 0, color: "var(--label-2)" }} value={it.colors.join(", ")} onChange={(e) => set({ colors: e.target.value.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
        </div>
        <div className="row"><span className="grow">Brand</span>
          <input className="field" style={{ textAlign: "right", width: "55%", padding: 0, color: "var(--label-2)" }} value={it.brand ?? ""} placeholder="Optional" onChange={(e) => set({ brand: e.target.value || undefined })} />
        </div>
      </div>
      <div className="group-header">How dressy</div>
      <Segmented label="Formality" value={String(it.formality) as any} onChange={(v) => set({ formality: Number(v) })}
        options={[{ value: "1", label: "Lounge" }, { value: "2", label: "Casual" }, { value: "3", label: "Smart" }, { value: "4", label: "Work" }, { value: "5", label: "Formal" }] as any} />
      <div className="group">
        <div className="row"><span className="grow">Worn</span><span className="value">{it.wornCount ? `${it.wornCount} times${it.lastWornAt ? `, last on ${new Date(it.lastWornAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}` : "Not yet"}</span></div>
        {it.sourceUrl && <a className="row" href={it.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--tint)", textDecoration: "none" }}><span className="grow">Open the store page</span><span className="chev">›</span></a>}
      </div>
      <div className="actions">
        {canTryOn(it.category) && <button className="btn filled block" onClick={() => onTryOn(it)}><Icon.person /> Try it on</button>}
        <button className="btn danger block" onClick={async () => { await deleteItem(it.id); hud("Removed"); onClose(); }}>Remove from wardrobe</button>
      </div>
    </Sheet>
  );
}
