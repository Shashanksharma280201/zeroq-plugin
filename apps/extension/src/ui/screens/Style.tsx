import { useEffect, useState } from "react";
import { MemoryView } from "../components/MemoryView.tsx";
import { clearProfile, saveProfile, type StyleProfile } from "../../lib/profile.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Page, Switch, transition, useHud, useProfile } from "../components/kit.tsx";
import { Onboarding } from "./Setup.tsx";

export function Style({ trailing, onMode }: { trailing?: React.ReactNode; /** told when setup starts and ends, so the page can hide its bars */ onMode?: (onboarding: boolean) => void } = {}) {
  const profile = useProfile();
  // Stay in onboarding until "Start shopping", even after the profile is saved,
  // so the reveal gets its moment.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (profile !== undefined && onboarding === null) setOnboarding(!profile);
  }, [profile]);
  useEffect(() => { onMode?.(!!onboarding); return () => onMode?.(false); }, [onboarding]);
  if (profile === undefined || onboarding === null) return null;
  if (onboarding || !profile) return <Onboarding onDone={() => transition(() => setOnboarding(false))} />;
  return <ProfileView p={profile} trailing={trailing} onRedo={() => transition(() => setOnboarding(true))} />;
}

/** Your best colours as one continuous band: the profile's signature. */
function PaletteBand({ p }: { p: StyleProfile }) {
  if (!p.palette.best.length) return null;
  return <div className="palette-band" aria-label={`Your colours: ${p.palette.best.map((s) => s.name).join(", ")}`}>{p.palette.best.map((s) => <i key={s.hex + s.name} style={{ background: s.hex }} />)}</div>;
}

function ProfileDetails({ p }: { p: StyleProfile }) {
  return (
    <div className="profile-details">
      <div className="words">{p.styleWords.map((w) => <span key={w}>{w}</span>)}</div>

      <h2 className="section">Your colours</h2>
      <div className="group pad">
        <div className="pal">{p.palette.best.map((s) => <div key={s.hex + s.name}><i style={{ background: s.hex }} /><span>{s.name}</span></div>)}</div>
        {p.palette.avoid.length > 0 && (
          <>
            <div className="meta" style={{ margin: "12px 0 8px" }}>Go easy on</div>
            <div className="pal avoid">{p.palette.avoid.map((s) => <div key={s.hex + s.name}><i style={{ background: s.hex }} /><span>{s.name}</span></div>)}</div>
          </>
        )}
        <div className="meta" style={{ marginTop: 12 }}>Undertone: {p.undertone}</div>
      </div>

      <div className="two-col">
        <div>
          <h2 className="section">You go for</h2>
          <ul className="bul good">{p.likes.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h2 className="section">You skip</h2>
          <ul className="bul">{p.dislikes.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>

      {p.answers.useFrame && p.frame && (
        <>
          <h2 className="section">What flatters you</h2>
          <div className="group pad">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{p.frame}</div>
            <ul className="bul good" style={{ margin: 0 }}>{[...p.flatters, ...p.fits].map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </>
      )}
    </div>
  );
}

function ProfileView({ p, onRedo, trailing }: { p: StyleProfile; onRedo: () => void; trailing?: React.ReactNode }) {
  const hud = useHud();
  return (
    <Page title="Me" trailing={trailing}>
      <div className="profile-hero">
        <div className="onb-stage small"><Avatar a={p.avatar} size={96} /></div>
        <div>
          <div className="greeting" style={{ fontSize: 30, margin: 0 }}>{p.styleName}</div>
          <p className="meta">{p.summary}</p>
        </div>
      </div>
      <PaletteBand p={p} />
      <ProfileDetails p={p} />
      <MemoryView p={p} />
      <div className="group">
        <div className="row">
          <span className="grow">Use my build in advice</span>
          <Switch on={p.answers.useFrame} onChange={(v) => saveProfile({ ...p, answers: { ...p.answers, useFrame: v } })} label="Use my build in advice" />
        </div>
        <button className="row" onClick={onRedo}><span className="grow link">Redo with new photos</span><span className="chev">›</span></button>
        <button className="row" onClick={async () => { await clearProfile(); hud("Profile deleted"); }}><span className="grow danger-link">Delete profile and photos</span></button>
      </div>
      <p className="group-footer">Built from {p.photoCount} outfits on {new Date(p.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}. Stored in this browser.</p>
    </Page>
  );
}
