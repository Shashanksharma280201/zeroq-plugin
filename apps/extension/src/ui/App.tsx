import { useState } from "react";
import type { WardrobeItem } from "@zq/core";
import { HudProvider, Icon, ZQMark, transition, useProfile, useSettings, useWardrobe } from "./components/kit.tsx";
import { DataHomeSheet, FolderBanner, useFolderAutosave } from "./components/DataHome.tsx";
import { Style } from "./screens/Style.tsx";
import { Settings } from "./screens/Settings.tsx";
import { ThisItem } from "./screens/ThisItem.tsx";
import { Today } from "./screens/Today.tsx";
import { TryOnSheet, type Garment } from "./screens/TryOn.tsx";
import { Wardrobe } from "./screens/Wardrobe.tsx";

type Tab = "item" | "style" | "today" | "wardrobe" | "settings";
type Surface = "sidepanel" | "app";

const TABS: Array<{ id: Tab; label: string; icon: () => JSX.Element; surfaces: Surface[] }> = [
  { id: "item", label: "This item", icon: Icon.tag, surfaces: ["sidepanel"] },
  { id: "style", label: "You", icon: Icon.face, surfaces: ["sidepanel", "app"] },
  { id: "today", label: "Today", icon: Icon.sun, surfaces: ["sidepanel", "app"] },
  { id: "wardrobe", label: "Wardrobe", icon: Icon.hanger, surfaces: ["sidepanel", "app"] },
  { id: "settings", label: "Settings", icon: Icon.gear, surfaces: ["sidepanel", "app"] },
];

export function App({ surface }: { surface: Surface }) {
  const wardrobe = useWardrobe();
  const profile = useProfile();
  const settings = useSettings();
  useFolderAutosave(settings);
  const hash = location.hash.slice(1) as Tab;
  const initial: Tab = surface === "sidepanel" ? "item" : ["style", "settings", "today", "wardrobe"].includes(hash) ? hash : "style";
  const [tab, setTab] = useState<Tab>(initial);
  const [garment, setGarment] = useState<Garment | null>(null);
  const go = (t: Tab) => t !== tab && transition(() => setTab(t));
  const tryItem = (i: WardrobeItem) => setGarment({ name: i.name, category: i.category, blobKey: i.image, itemKey: `wardrobe:${i.id}` });

  return (
    <HudProvider>
      <div className="shell">
        <nav className="tabbar" aria-label="Sections">
          <div className="brand"><ZQMark /> Zero Q</div>
          {TABS.filter((t) => t.surfaces.includes(surface)).map((t) => (
            <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              <t.icon />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <main className="view">
          <FolderBanner />
          {wardrobe == null ? null : tab === "item" ? (
            <ThisItem wardrobe={wardrobe} profile={profile} onTryOn={(g) => setGarment(g)} goWardrobe={() => go("wardrobe")} goStyle={() => go("style")} />
          ) : tab === "style" ? (
            <Style />
          ) : tab === "today" ? (
            <Today wardrobe={wardrobe} goWardrobe={() => go("wardrobe")} />
          ) : tab === "wardrobe" ? (
            <Wardrobe wardrobe={wardrobe} onTryOn={tryItem} />
          ) : (
            <Settings wardrobe={wardrobe} surface={surface} />
          )}
        </main>
      </div>
      <TryOnSheet garment={garment} onClose={() => setGarment(null)} />
      <DataHomeSheet />
    </HudProvider>
  );
}
