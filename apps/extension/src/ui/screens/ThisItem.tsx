import { aiReady } from "../../lib/settings.ts";
import { useEffect, useMemo, useState } from "react";
import { checkProduct, classifyProduct, type DetectedProduct, type ProductCheck, type WardrobeItem } from "@zq/core";
import { productTake } from "../../lib/ai.ts";
import { addItem } from "../../lib/db.ts";
import { srcToBlob } from "../../lib/images.ts";
import type { Pick, TabState } from "../../lib/messages.ts";
import type { StyleProfile } from "../../lib/profile.ts";
import { RatingPanel } from "../components/Rating.tsx";
import { BrandShop } from "./BrandShop.tsx";
import { canTryOn } from "../../lib/vto.ts";
import { Icon, ItemImg, Page, ZQMark, money, useHud, useSettings } from "../components/kit.tsx";

function useActiveProduct(): { product: DetectedProduct | null; pick: Pick | null; tabId?: number; loading: boolean; recheck: () => void; clearPick: () => void } {
  const [tabId, setTabId] = useState<number>();
  const [product, setProduct] = useState<DetectedProduct | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
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
    const pk = `pick:${tabId}`;
    chrome.storage.session.get(pk).then((s) => setPick((s[pk] as Pick | undefined) ?? null));
    chrome.storage.session.get(key).then((s) => {
      const st = s[key] as TabState | undefined;
      if (st) {
        setProduct(st.product);
        setLoading(false);
      } else recheck(); // content script has not reported yet, or trigger is off
    });
    const h = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && ch[key]) setProduct((ch[key].newValue as TabState | undefined)?.product ?? null);
      if (area === "session" && ch[pk]) setPick((ch[pk].newValue as Pick | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(h);
    return () => chrome.storage.onChanged.removeListener(h);
  }, [tabId]);

  const clearPick = () => tabId != null && chrome.storage.session.remove(`pick:${tabId}`);
  return { product, pick, tabId, loading: loading && !pick, recheck, clearPick };
}

const takeCache = new Map<string, string>();

export function ThisItem({ wardrobe, profile, onTryOn, goWardrobe, goStyle }: { wardrobe: WardrobeItem[]; profile: StyleProfile | null | undefined; onTryOn: (g: { src: string; category: ProductCheck["product"]["category"]; name: string }) => void; goWardrobe: () => void; goStyle: () => void }) {
  const { product, pick, tabId, loading, recheck, clearPick } = useActiveProduct();
  const [showPick, setShowPick] = useState(true);
  const [shopping, setShopping] = useState<{ origin: string; selected: DetectedProduct | null } | null>(null);
  useEffect(() => setShopping(null), [tabId]);
  useEffect(() => setShowPick(true), [pick?.at]);
  const settings = useSettings();
  const hud = useHud();
  // Once you buy it, it is in the wardrobe; never compare the item with itself.
  const others = useMemo(() => (product ? wardrobe.filter((i) => i.sourceUrl !== product.url) : wardrobe), [product, wardrobe]);
  const check = useMemo(() => (product ? checkProduct(classifyProduct(product), others) : null), [product, others]);
  const [take, setTake] = useState<string | null>(null);
  const [takeErr, setTakeErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const owned = product ? wardrobe.find((i) => i.sourceUrl === product.url) : undefined;

  useEffect(() => {
    setTake(null);
    setTakeErr(null);
    // With a style profile the formula's score replaces this take: skip the extra AI call.
    if (!check || !aiReady(settings) || wardrobe.length === 0 || profile) return;
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
  }, [check?.product.url, wardrobe.length, aiReady(settings), !!profile]);

  if (shopping) {
    return <BrandShop origin={shopping.origin} tabId={tabId} selected={shopping.selected} profile={profile} wardrobe={wardrobe} onBack={() => setShopping(null)} />;
  }

  const originOf = (u: string) => { try { return new URL(u).origin; } catch { return null; } };

  if (pick && showPick) {
    const host = (() => { try { return new URL(pick.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    return (
      <div className="item-screen">
        <header className="item-top">
          <ZQMark size={20} />
          <span className="host truncate grow">{host}</span>
          <button className="btn plain small" style={{ textDecoration: "none" }} onClick={() => { setShowPick(false); if (!product) clearPick(); }}>{product ? "Page item" : "Done"}</button>
        </header>
        <div className="content">
          <figure className="hero solo" key={`hero-${pick.src}`}>
            <img className="hero-img" src={pick.src} alt={pick.alt ?? "Picked item"} referrerPolicy="no-referrer" />
          </figure>
          <RatingPanel key={`rate-${pick.src}`} src={pick.src} title={pick.title} url={pick.url} hint={pick.alt} profile={profile} wardrobe={wardrobe} tabId={tabId}
            goStyle={goStyle} onTryOn={(category) => onTryOn({ src: pick.src, category: category as any, name: pick.alt || "this item" })} />
          {originOf(pick.url)?.startsWith("http") && (
            <button className="btn gray block find-better" onClick={() => setShopping({ origin: originOf(pick.url)!, selected: { name: pick.alt || "This item", url: pick.url, images: [pick.src], via: "open-graph" } })}>
              Find better on {host}
            </button>
          )}
          <p className="hint" style={{ margin: "0 4px 24px" }}>Rate another: right-click any photo, or press <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>X</kbd> and click it.</p>
        </div>
      </div>
    );
  }

  if (loading && !product) {
    return (
      <Page title="This item">
        <div style={{ display: "grid", gridTemplateColumns: "112px 1fr", gap: 14, alignItems: "end", margin: "12px 0 20px" }}>
          <div className="skeleton" style={{ height: 149, borderRadius: 14, margin: 0 }} />
          <div><div className="skeleton" style={{ width: "40%" }} /><div className="skeleton" style={{ width: "90%", height: 16 }} /><div className="skeleton" style={{ width: "30%" }} /></div>
        </div>
        <div className="skeleton" style={{ height: 180, borderRadius: 22 }} />
      </Page>
    );
  }

  if (!product || !check) {
    return (
      <Page title="This item">
        <div className="empty">
          <div className="glyph"><Icon.bag /></div>
          <h3>Open a product page</h3>
          <p>Open any item on Myntra, Ajio, Zara or a brand's own store, or point at a clothing photo anywhere to get its score.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {tabId != null && <button className="btn filled small" onClick={() => chrome.tabs.sendMessage(tabId, { type: "pick-start" }).catch(() => {})}><Icon.target /> Point at an item</button>}
            <button className="btn gray small" onClick={recheck}>Check this page</button>
          </div>
        </div>
      </Page>
    );
  }

  const p = check.product;
  const v = owned
    ? { word: "It's yours", why: `In your wardrobe since ${new Date(owned.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}. Here is what it goes with.`, tone: "buy" }
    : verdictCopy(check, others.length);

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

  const host = (() => { try { return new URL(p.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  // When a style score is possible it answers the screen's question, so it leads
  // and the wardrobe check becomes its supporting section. Without one, the
  // wardrobe verdict is the answer and gets the card.
  const scored = !!profile && aiReady(settings) && !!p.images[0];
  const dup = check.duplicates[0];

  const pairsRail = check.pairs.length > 0 && (
    <div className="rail">
      {check.pairs.map((m) => (
        <div className="pair" key={m.item.id}>
          <div className="pair-imgs">
            {p.images[0] ? <img src={p.images[0]} alt="" referrerPolicy="no-referrer" /> : <div />}
            <ItemImg item={m.item} />
          </div>
          <div className="name truncate">{m.item.name}</div>
          <div className="sub">{cap(m.reason)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="item-screen">
      <header className="item-top">
        <ZQMark size={20} />
        <span className="host truncate grow">{host}</span>
      </header>

      <div className="content">
        <figure className="hero" key={p.url}>
          {p.images[0] ? <img className="hero-img" src={p.images[0]} alt={p.name} referrerPolicy="no-referrer" /> : <div className="hero-img" />}
          <figcaption className="hero-cap">
            {p.brand && <div className="brand">{p.brand}</div>}
            <div className="pname">{p.name}</div>
            {p.price != null && <div className="price">{money(p.price, p.currency)}</div>}
          </figcaption>
        </figure>

        {scored ? (
          <>
            <RatingPanel key={`rate-${p.images[0]}`} src={p.images[0]} title={p.name} url={p.url} hint={[p.brand, p.name].filter(Boolean).join(" ")} profile={profile} wardrobe={others} tabId={tabId}
              goStyle={goStyle} />
            <div className="wcheck">
              <h2 className="section">{owned ? "It's in your wardrobe" : "With your wardrobe"}</h2>
              {others.length > 0 && <span className="meta">{check.pairs.length} {check.pairs.length === 1 ? "pairing" : "pairings"}, {check.duplicates.length} {check.duplicates.length === 1 ? "look-alike" : "look-alikes"}</span>}
            </div>
            {dup && !owned && (
              <div className="dup-note">
                <ItemImg item={dup.item} />
                <span>You own a near twin: your {dup.item.name.toLowerCase()}{dup.item.wornCount ? `, worn ${dup.item.wornCount} times` : ""}.</span>
              </div>
            )}
            {pairsRail || (others.length > 0
              ? <p className="hint" style={{ margin: "0 4px 24px" }}>Nothing you own goes with it yet. You would be buying an outfit, not a piece.</p>
              : <p className="hint" style={{ margin: "0 4px 24px" }}>Add your clothes in Wardrobe to see what this goes with.</p>)}
          </>
        ) : (
          <>
            <section className={`verdict ${v.tone}`} key={`v-${p.url}`} aria-live="polite">
              <div className="word">{v.word}</div>
              <div className="why">{v.why}</div>
              {others.length > 0 && (
                <div className="v-stats">
                  <div><b>{check.pairs.length}</b><span>{check.pairs.length === 1 ? "pairing" : "pairings"}</span></div>
                  <div><b>{check.duplicates.length}</b><span>{check.duplicates.length === 1 ? "look-alike" : "look-alikes"}</span></div>
                  <div><b>{wardrobe.length}</b><span>in wardrobe</span></div>
                </div>
              )}
              {aiReady(settings) && others.length > 0 && (
                take ? <div className="take"><Icon.sparkle />{take}</div>
                  : takeErr ? <div className="take">{takeErr}</div>
                  : <div className="take"><div style={{ flex: 1 }}><div className="skeleton" style={{ width: "92%" }} /><div className="skeleton" style={{ width: "70%" }} /></div></div>
              )}
            </section>
            {!profile && (
              <RatingPanel src={p.images[0] ?? ""} title={p.name} url={p.url} profile={profile} wardrobe={others} goStyle={goStyle} />
            )}
            {check.duplicates.length > 0 && (
              <>
                <h2 className="section">Already in your wardrobe</h2>
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
            {pairsRail && <><h2 className="section">Outfits it makes</h2>{pairsRail}</>}
          </>
        )}

        <button className="btn gray block find-better" style={{ marginTop: 4 }} onClick={() => setShopping({ origin: new URL(p.url).origin, selected: product })}>
          Find better on {p.brand || host}
        </button>

        {wardrobe.length < 10 && (
          <button className="btn plain" style={{ display: "flex", margin: "0 auto 8px" }} onClick={goWardrobe}>Add your own clothes for better matches</button>
        )}
      </div>

      <div className="action-bar">
        {canTryOn(p.category) && p.images[0] && (
          <button className="btn gray" onClick={() => onTryOn({ src: p.images[0], category: p.category, name: p.name })}>
            <Icon.person /> Try on
          </button>
        )}
        <button className={`btn ${owned ? "done" : "filled"}`} onClick={owned ? undefined : bought} disabled={adding} aria-disabled={!!owned}>
          {owned ? <><Icon.check /> In wardrobe</> : adding ? "Adding" : "I bought this"}
        </button>
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
