import { useEffect, useState } from "react";
import type { WardrobeItem } from "@zq/core";
import { HudProvider, Icon, ZQMark, transition, useProfile, useSettings, useWardrobe } from "./components/kit.tsx";
import { DataHomeSheet, FolderBanner, useFolderAutosave } from "./components/DataHome.tsx";
import { Avatar } from "./components/Avatar.tsx";
import { ScoreDot } from "./components/Outfit.tsx";
import { cachedRating } from "./components/Rating.tsx";
import { Searched } from "./screens/Searched.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Style } from "./screens/Style.tsx";
import { ThisItem, useActiveProduct } from "./screens/ThisItem.tsx";
import { TryOnSheet, type Garment } from "./screens/TryOn.tsx";
import { Wardrobe } from "./screens/Wardrobe.tsx";

/**
 * Two tabs: Searched (everything you asked about, each with an outfit) and
 * Wardrobe (everything you own, each with an outfit). On a shop page the
 * "Should I buy this?" answer opens on top. Profile and settings live behind
 * your avatar.
 */
type Tab = "searched" | "wardrobe";
type Over = null | "item" | "me" | "settings";
type Surface = "sidepanel" | "app";

export function App({ surface }: { surface: Surface }) {
  const wardrobe = useWardrobe();
  const profile = useProfile();
  const settings = useSettings();
  useFolderAutosave(settings);
  const hash = location.hash.slice(1);
  const [tab, setTab] = useState<Tab>(hash === "wardrobe" || hash === "today" ? "wardrobe" : "searched");
  const [over, setOver] = useState<Over>(hash === "settings" ? "settings" : hash === "style" || hash === "you" ? "me" : null);
  const [garment, setGarment] = useState<Garment | null>(null);
  const active = useActiveProduct();
  const go = (t: Tab) => transition(() => (setTab(t), setOver(null)));
  const open = (o: Over) => transition(() => setOver(o));
  const tryItem = (i: WardrobeItem) => setGarment({ name: i.name, category: i.category, blobKey: i.image, itemKey: `wardrobe:${i.id}` });

  // A new pick (right-click or point) is a question: answer it straight away.
  useEffect(() => {
    if (surface === "sidepanel" && active.pick && Date.now() - active.pick.at < 15_000) setOver("item");
  }, [active.pick?.at]);
  // First run: build the profile before anything else.
  useEffect(() => {
    if (profile === null && over == null) setOver("me");
  }, [profile === null]);

  const now = surface === "sidepanel" && over !== "item" ? <NowCard active={active} onOpen={() => open("item")} /> : null;

  return (
    <HudProvider>
      <div className="shell two">
        <header className="topbar">
          {over && !(over === "me" && !profile) ? (
            <button className="back" onClick={() => open(over === "settings" && profile ? "me" : null)} aria-label="Back"><Icon.chevronLeft /><span>{over === "settings" && profile ? "You" : tab === "wardrobe" ? "Wardrobe" : "Searched"}</span></button>
          ) : (
            <div className="brand"><ZQMark /> Zero Q</div>
          )}
          <div className="top-actions">
            {over === "me" && profile && <button className="icon-btn" aria-label="Settings" onClick={() => open("settings")}><Icon.gear /></button>}
            {over == null && (
              <button className="me-btn" aria-label="You and settings" onClick={() => open("me")}>
                {profile ? <span className="me-av"><Avatar a={profile.avatar} size={30} /></span> : <Icon.face />}
              </button>
            )}
          </div>
        </header>
        <main className="view">
          <FolderBanner />
          {wardrobe == null ? null : over === "item" ? (
            <ThisItem wardrobe={wardrobe} profile={profile} onTryOn={(g) => setGarment(g)} goWardrobe={() => go("wardrobe")} goStyle={() => open("me")} />
          ) : over === "me" ? (
            <Style />
          ) : over === "settings" ? (
            <Settings wardrobe={wardrobe} surface={surface} />
          ) : tab === "searched" ? (
            <Searched wardrobe={wardrobe} top={now} />
          ) : (
            <Wardrobe wardrobe={wardrobe} onTryOn={tryItem} top={now} />
          )}
        </main>
        {over !== "me" || profile ? (
          <nav className="tabbar2" aria-label="Sections">
            {(["searched", "wardrobe"] as Tab[]).map((t) => (
              <button key={t} className="tab2" aria-current={over == null && tab === t ? "page" : undefined} onClick={() => go(t)}>
                {t === "searched" ? <Icon.search /> : <Icon.hanger />}
                <span>{t === "searched" ? "Searched" : "Wardrobe"}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </div>
      <TryOnSheet garment={garment} onClose={() => setGarment(null)} />
      <DataHomeSheet />
    </HudProvider>
  );
}

/** The product on the open tab, one tap from its answer. */
function NowCard({ active, onOpen }: { active: ReturnType<typeof useActiveProduct>; onOpen: () => void }) {
  const p = active.product;
  const src = active.pick?.src ?? p?.images[0];
  if (!src) return null;
  const name = active.pick ? active.pick.alt || "The item you picked" : p?.name ?? "";
  const r = cachedRating(src);
  return (
    <button className="now-card" onClick={onOpen} aria-label={`Now viewing ${name}. ${r ? `Score ${r.score}.` : ""} Open the answer.`}>
      <span className="now-img"><img src={src} alt="" referrerPolicy="no-referrer" />{r && <ScoreDot n={r.score} />}</span>
      <span className="now-txt"><span className="caps">Now viewing</span><b className="truncate">{name}</b><span className="now-q">{r ? r.verdict : "Should I buy this?"}</span></span>
      <Icon.chevronRight />
    </button>
  );
}
