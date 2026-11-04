import { useEffect, useRef, useState } from "react";
import {
  buildProfile, clearProfile, getOutfitPhotos, saveOutfitPhotos, saveProfile,
  type Answers, type Avatar as AvatarT, type StyleProfile,
} from "../../lib/profile.ts";
import { setSettings } from "../../lib/settings.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Icon, Page, Switch, transition, useHud, useProfile, useSettings } from "../components/kit.tsx";

const PLACEHOLDER: AvatarT = {
  skin: "#d9d4cf", hair: "#b9b3ad", hairStyle: "short", facialHair: "none", glasses: false, build: "average", height: "average",
  top: "#c9c4be", bottom: "#b3ada7", shoes: "#d9d4cf", topStyle: "tee", bottomStyle: "trousers",
};
const SHOP_FOR = ["Work", "Everyday", "Going out", "Ethnic", "Weddings", "Gym", "Travel"];
const BUDGETS = ["Under ₹1,500", "₹1,500 to 3,000", "₹3,000 to 6,000", "₹6,000+"];
const MIN = 3;
const MAX = 5;

type Step = "intro" | "photos" | "questions" | "building" | "reveal";

export function Style() {
  const profile = useProfile();
  // Stay in onboarding until "Start shopping", even after the profile is saved,
  // so the reveal gets its moment.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (profile !== undefined && onboarding === null) setOnboarding(!profile);
  }, [profile]);
  if (profile === undefined || onboarding === null) return null;
  if (onboarding || !profile) return <Onboarding onDone={() => transition(() => setOnboarding(false))} />;
  return <ProfileView p={profile} onRedo={() => transition(() => setOnboarding(true))} />;
}

// ---------- onboarding ----------

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [photos, setPhotos] = useState<Array<{ blob: Blob; url: string }>>([]);
  const [answers, setAnswers] = useState<Answers>({ shopFor: [], useFrame: true });
  const [result, setResult] = useState<StyleProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = (s: Step) => transition(() => setStep(s));

  useEffect(() => {
    // Reuse photos from a previous profile when redoing.
    getOutfitPhotos().then((b) => b.length && setPhotos(b.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))));
  }, []);

  const build = async () => {
    setErr(null);
    go("building");
    try {
      const blobs = photos.map((p) => p.blob);
      await saveOutfitPhotos(blobs);
      const p = await buildProfile(blobs, answers);
      setResult(p);
      await saveProfile(p);
      go("reveal");
    } catch (e: any) {
      setErr(e.message ?? String(e));
      go("questions");
    }
  };

  if (step === "intro") {
    return (
      <div className="onb">
        <div className="onb-stage"><Avatar a={PLACEHOLDER} size={130} /></div>
        <h1 className="onb-title">Let's get to know your style</h1>
        <p className="onb-sub">Show Zero Q five outfits you love wearing. It works out your colours, your shapes and your taste, then rates anything you point at on any site.</p>
        <ol className="onb-steps">
          <li><span>1</span>Five favourite outfits, head to toe</li>
          <li><span>2</span>Three quick taps</li>
          <li><span>3</span>Meet your style character</li>
        </ol>
        <div className="onb-cta"><button className="btn filled block" onClick={() => go("photos")}>Get started</button></div>
      </div>
    );
  }

  if (step === "photos") return <PhotoStep photos={photos} setPhotos={setPhotos} onBack={() => go("intro")} onNext={() => go("questions")} />;

  if (step === "questions") {
    return <QuestionStep answers={answers} setAnswers={setAnswers} err={err} onBack={() => go("photos")} onBuild={build} count={photos.length} />;
  }

  if (step === "building") return <Building photos={photos.map((p) => p.url)} />;

  return result ? <Reveal p={result} onDone={onDone} /> : null;
}

function PhotoStep({ photos, setPhotos, onBack, onNext }: { photos: Array<{ blob: Blob; url: string }>; setPhotos: (f: (p: Array<{ blob: Blob; url: string }>) => Array<{ blob: Blob; url: string }>) => void; onBack: () => void; onNext: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const add = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPhotos((p) => [...p, ...list.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))].slice(0, MAX));
  };
  const n = photos.length;
  return (
    <div className="onb">
      <Back onClick={onBack} />
      <h1 className="onb-title">Your five best outfits</h1>
      <p className="onb-sub">Full length, head to toe, the ones you feel great in. Mirror selfies are perfect. One outfit per photo.</p>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
      <div className="slots" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
        {Array.from({ length: MAX }).map((_, i) =>
          photos[i] ? (
            <div className="slot filled" key={photos[i].url}>
              <img src={photos[i].url} alt={`Outfit ${i + 1}`} />
              <button className="slot-x" aria-label={`Remove outfit ${i + 1}`} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ) : (
            <button className={`slot ${i === n ? "next" : ""}`} key={`e${i}`} onClick={() => input.current?.click()} aria-label="Add outfit photo">
              <Icon.plus />
            </button>
          ),
        )}
      </div>
      <div className="dots" aria-hidden>{Array.from({ length: MAX }).map((_, i) => <i key={i} className={i < n ? "on" : ""} />)}</div>
      <p className="hint" style={{ textAlign: "center", margin: "6px 0 0" }}>
        {n < MIN ? `Add at least ${MIN - n} more.` : n < MAX ? "Five gives the sharpest read, but you can go on." : "Perfect."}
      </p>
      <div className="onb-cta"><button className="btn filled block" disabled={n < MIN} onClick={onNext}>Continue</button></div>
    </div>
  );
}

function QuestionStep({ answers, setAnswers, err, onBack, onBuild, count }: { answers: Answers; setAnswers: (a: Answers) => void; err: string | null; onBack: () => void; onBuild: () => void; count: number }) {
  const st = useSettings();
  const toggle = (s: string) => setAnswers({ ...answers, shopFor: answers.shopFor.includes(s) ? answers.shopFor.filter((x) => x !== s) : [...answers.shopFor, s] });
  return (
    <div className="onb">
      <Back onClick={onBack} />
      <h1 className="onb-title">Three quick taps</h1>
      <p className="onb-sub">So the advice fits your life, not just your photos.</p>

      <div className="group-header">What do you shop for most?</div>
      <div className="chips wrap">
        {SHOP_FOR.map((s) => <button key={s} className="chip" aria-pressed={answers.shopFor.includes(s)} onClick={() => toggle(s)}>{s}</button>)}
      </div>

      <div className="group-header">Usual spend on one piece</div>
      <div className="chips wrap">
        {BUDGETS.map((b) => <button key={b} className="chip" aria-pressed={answers.budget === b} onClick={() => setAnswers({ ...answers, budget: b })}>{b}</button>)}
      </div>

      <div className="group-header">Anything you never wear?</div>
      <div className="group">
        <input className="field" placeholder="For example skinny jeans, neon, crop tops" value={answers.never ?? ""} onChange={(e) => setAnswers({ ...answers, never: e.target.value })} />
      </div>

      <div className="group">
        <div className="row">
          <span className="grow">Use my build in advice<div className="meta">Zero Q reads your frame from the photos to suggest cuts that flatter it. It never asks or judges.</div></span>
          <Switch on={answers.useFrame} onChange={(v) => setAnswers({ ...answers, useFrame: v })} label="Use my build in advice" />
        </div>
      </div>

      {st && !st.anthropicKey && (
        <>
          <div className="group-header">Your Claude API key</div>
          <div className="group">
            <input className="field" type="password" placeholder="sk-ant-..." autoComplete="off" onChange={(e) => setSettings({ anthropicKey: e.target.value.trim() })} aria-label="Claude API key" />
          </div>
          <p className="group-footer">Claude reads your photos. The key stays in this browser. Get one at console.anthropic.com.</p>
        </>
      )}
      {err && <p className="error">{err}</p>}
      <div className="onb-cta"><button className="btn filled block" disabled={!st?.anthropicKey} onClick={onBuild}>Read my {count} outfits</button></div>
    </div>
  );
}

const LINES = ["Looking at your outfits", "Finding colours that suit you", "Spotting what you repeat", "Reading your silhouette", "Sketching your character"];

function Building({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(LINES.length - 1, x + 1)), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="onb building">
      <div className="fan" aria-hidden>
        {photos.map((u, k) => <img key={u} src={u} alt="" style={{ "--k": k - (photos.length - 1) / 2 } as any} />)}
        <div className="scanline" />
      </div>
      <h1 className="onb-title" key={i}>{LINES[i]}</h1>
      <p className="onb-sub">This takes about 20 seconds.</p>
    </div>
  );
}

function Reveal({ p, onDone }: { p: StyleProfile; onDone: () => void }) {
  const [mood, setMood] = useState<"wave" | "idle">("wave");
  useEffect(() => {
    const t = setTimeout(() => setMood("idle"), 2600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="onb reveal">
      <div className="onb-stage glow" style={{ "--glow": p.palette.best[0]?.hex ?? "#5e5ce6" } as any}>
        <Avatar a={p.avatar} mood={mood} size={140} />
      </div>
      <div className="eyebrow">Meet your style</div>
      <h1 className="onb-title">{p.styleName}</h1>
      <p className="onb-sub">{p.summary}</p>
      <ProfileDetails p={p} />
      <div className="onb-cta"><button className="btn filled block" onClick={onDone}>Start shopping</button></div>
      <p className="hint" style={{ textAlign: "center" }}>On any site, right-click a photo and choose Rate this for me, or press <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>X</kbd> and click it.</p>
    </div>
  );
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

function ProfileView({ p, onRedo }: { p: StyleProfile; onRedo: () => void }) {
  const hud = useHud();
  return (
    <Page title="Your style">
      <div className="profile-hero">
        <div className="onb-stage glow small" style={{ "--glow": p.palette.best[0]?.hex ?? "#5e5ce6" } as any}><Avatar a={p.avatar} size={100} /></div>
        <div>
          <div className="eyebrow">{p.styleWords.slice(0, 3).join(", ")}</div>
          <div className="pname" style={{ font: "700 26px/1.1 var(--font-display)", letterSpacing: "-0.025em" }}>{p.styleName}</div>
          <p className="hint" style={{ fontSize: 14, marginTop: 6 }}>{p.summary}</p>
        </div>
      </div>
      <ProfileDetails p={p} />
      <div className="group">
        <div className="row">
          <span className="grow">Use my build in advice</span>
          <Switch on={p.answers.useFrame} onChange={(v) => saveProfile({ ...p, answers: { ...p.answers, useFrame: v } })} label="Use my build in advice" />
        </div>
        <button className="row" onClick={onRedo}><span className="grow" style={{ color: "var(--tint)" }}>Redo with new photos</span><span className="chev">›</span></button>
        <button className="row" onClick={async () => { await clearProfile(); hud("Profile deleted"); }}><span className="grow" style={{ color: "var(--bad)" }}>Delete profile and photos</span></button>
      </div>
      <p className="group-footer">Built from {p.photoCount} outfits on {new Date(p.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })}. Stored only in this browser.</p>
    </Page>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return <button className="btn plain back" onClick={onClick}>‹ Back</button>;
}
