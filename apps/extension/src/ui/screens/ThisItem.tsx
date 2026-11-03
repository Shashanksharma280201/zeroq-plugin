import { useEffect, useMemo, useState } from "react";
import { checkProduct, classifyProduct, type DetectedProduct, type ProductCheck, type WardrobeItem } from "@zq/core";
import { productTake } from "../../lib/ai.ts";
import { addItem } from "../../lib/db.ts";
import { srcToBlob } from "../../lib/images.ts";
import type { TabState } from "../../lib/messages.ts";
import { canTryOn } from "../../lib/vto.ts";
import { Icon, ItemImg, Page, money, useHud, useSettings } from "../components/kit.tsx";

function useActiveProduct(): { product: DetectedProduct | null; loading: boolean; recheck: () => void } {
  const [tabId, setTabId] = useState<number>();
  const [product, setProduct] = useState<DetectedProduct | null>(null);
  const [loading, setLoading] = useState(true);

  // ?tab=<id> pins the panel to one tab, used when previewing sidepanel.html in a normal tab.
  const pinned = Number(new URLSearchParams(location.search).get("tab")) || undefined;
  const findTab = () =>
    pinned ? Promise.resolve(setTabId(pinned)) : chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTabId(t?.id));

  useEffect(() => {
    findTab();
    const a = () => findTab();
    const u = (_id: number, info: chrome.tabs.TabChangeInfo) => info.status === "complete" && findTab();
    chrome.tabs.onActivated.addListener(a);
    chrome.tabs.onUpdated.addListener(u);
    return () => {
      chrome.tabs.onActivated.removeListener(a);
      chrome.tabs.onUpdated.removeListener(u);
    };
  }, []);

  const recheck = () => {
    if (tabId == null) return;
    setLoading(true);
    chrome.tabs
      .sendMessage(tabId, { type: "detect" })
      .then((p: DetectedProduct | null) => setProduct(p ?? null))
      .catch(() => setProduct(null)) // chrome:// pages, the web store, or a tab opened before install
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tabId == null) return;
    const key = `tab:${tabId}`;
    chrome.storage.session.get(key).then((s) => {
      const st = s[key] as TabState | undefined;
      if (st) {
        setProduct(st.product);
        setLoading(false);
      } else recheck(); // content script has not reported yet, or trigger is off
    });
    const h = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && ch[key]) setProduct((ch[key].newValue as TabState | undefined)?.product ?? null);
    };
    chrome.storage.onChanged.addListener(h);
    return () => chrome.storage.onChanged.removeListener(h);
  }, [tabId]);

  return { product, loading, recheck };
}

const takeCache = new Map<string, string>();

export function ThisItem({ wardrobe, onTryOn, goWardrobe }: { wardrobe: WardrobeItem[]; onTryOn: (g: { src: string; category: ProductCheck["product"]["category"]; name: string }) => void; goWardrobe: () => void }) {
  const { product, loading, recheck } = useActiveProduct();
  const settings = useSettings();
  const hud = useHud();
  const check = useMemo(() => (product ? checkProduct(classifyProduct(product), wardrobe) : null), [product, wardrobe]);
  const [take, setTake] = useState<string | null>(null);
  const [takeErr, setTakeErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const owned = product ? wardrobe.find((i) => i.sourceUrl === product.url) : undefined;

  useEffect(() => {
    setTake(null);
    setTakeErr(null);
    if (!check || !settings?.anthropicKey || wardrobe.length === 0) return;
    const k = `${check.product.url}|${wardrobe.length}`;
    if (takeCache.has(k)) return setTake(takeCache.get(k)!);
    let live = true;
    (async () => {
      const img = check.product.images[0] ? await srcToBlob(check.product.images[0], 768).catch(() => undefined) : undefined;
      const t = await productTake(check, wardrobe, img);
      takeCache.set(k, t);
      if (live) setTake(t);
    })().catch((e) => live && setTakeErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [check?.product.url, wardrobe.length, settings?.anthropicKey]);

  if (loading && !product) {
    return (
      <Page title="This item">
        <div className="shimmer" style={{ height: 128, borderRadius: 16 }} />
        <div className="shimmer" style={{ height: 96, borderRadius: 22, marginTop: 16 }} />
      </Page>
    );
  }

  if (!product || !check) {
    return (
      <Page title="This item">
        <div className="empty">
          <div className="glyph"><Icon.bag /></div>
          <h3>Open a product page</h3>
          <p>Go to any item on Myntra, Ajio, Zara, H&amp;M or a brand's own store. Zero Q checks it against your wardrobe.</p>
          <button className="btn tinted small" onClick={recheck}>Check this page</button>
        </div>
      </Page>
    );
  }

  const p = check.product;
  const v = verdictCopy(check, wardrobe.length);

  const bought = async () => {
    setAdding(true);
    try {
      await addItem({
        name: p.name.replace(/^(men|women|mens|womens)\s+/i, ""),
        category: p.category,
        kind: p.kind,
        colors: p.colors,
        formality: p.formality,
        brand: p.brand,
        price: p.price,
        currency: p.currency,
        sourceUrl: p.url,
        imageSrc: p.images[0],
        source: "product-page",
      });
      hud("Added to wardrobe");
    } catch (e: any) {
      hud(e.message ?? "Could not add it", "err");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Page title="This item">
      <div className="product">
        {p.images[0] ? <img className="pimg" src={p.images[0]} alt="" referrerPolicy="no-referrer" /> : <div className="pimg" />}
        <div>
          {p.brand && <div className="brand">{p.brand}</div>}
          <div className="pname">{p.name}</div>
          <div className="price">{money(p.price, p.currency)}</div>
        </div>
      </div>

      <section className={`verdict ${v.tone}`} key={p.url} aria-live="polite">
        <div className="word">{v.word}</div>
        <div className="why">{v.why}</div>
        {settings?.anthropicKey && wardrobe.length > 0 && (
          take ? <div className="take">{take}</div>
            : takeErr ? <div className="take">{takeErr}</div>
            : <div className="take loading"><div className="shimmer" style={{ width: "92%" }} /><div className="shimmer" style={{ width: "70%" }} /></div>
        )}
      </section>

      {check.duplicates.length > 0 && (
        <>
          <div className="group-header">Already in your wardrobe</div>
          <div className="group">
            {check.duplicates.map((d) => (
              <div className="row thumb-row" key={d.item.id}>
                <ItemImg item={d.item} className="thumb" />
                <div className="grow">
                  <div className="truncate">{d.item.name}</div>
                  <div className="meta">{d.reason.replace("You own this: ", "")}{d.item.wornCount ? `, worn ${d.item.wornCount} times` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {check.pairs.length > 0 && (
        <>
          <div className="group-header">Goes with</div>
          <div className="rail">
            {check.pairs.map((m) => (
              <div className="tile" key={m.item.id} title={m.reason}>
                <div className="img"><ItemImg item={m.item} /></div>
                <div className="name truncate">{m.item.name}</div>
                <div className="sub truncate">{m.reason}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="actions">
        {canTryOn(p.category) && p.images[0] && (
          <button className="btn filled block" onClick={() => onTryOn({ src: p.images[0], category: p.category, name: p.name })}>
            <Icon.person /> Try it on
          </button>
        )}
        {owned ? (
          <button className="btn gray block" disabled>In your wardrobe</button>
        ) : (
          <button className="btn tinted block" onClick={bought} disabled={adding}>
            {adding ? "Adding" : "I bought this"}
          </button>
        )}
        {wardrobe.length < 10 && (
          <button className="btn plain" onClick={goWardrobe}>Add your own clothes for better matches</button>
        )}
      </div>
    </Page>
  );
}

function verdictCopy(c: ProductCheck, size: number): { word: string; why: string; tone: string } {
  if (size === 0) return { word: "Start your wardrobe", why: "Add 5 tops and 5 bottoms you own and this card tells you what pairs and what you already have.", tone: "think" };
  const dup = c.duplicates[0];
  if (c.verdict === "skip" && dup) return { word: "You have this", why: `Your ${dup.item.name.toLowerCase()} is almost the same thing.`, tone: "skip" };
  if (dup) return { word: "Close to one you own", why: `Similar to your ${dup.item.name.toLowerCase()}. Worth it only if it does something that one does not.`, tone: "skip" };
  if (c.verdict === "buy") return { word: "Worth it", why: `Goes with ${c.pairs.length} things you own and nothing in your wardrobe is like it.`, tone: "buy" };
  if (c.pairs.length === 1) return { word: "Think it over", why: `Only your ${c.pairs[0].item.name.toLowerCase()} goes with it so far.`, tone: "think" };
  if (c.product.category === "other") return { word: "Not sure what this is", why: "Zero Q could not tell the type of item from this page.", tone: "think" };
  return { word: "Think it over", why: "Nothing you own pairs with it yet. You would be buying an outfit, not a piece.", tone: "think" };
}
