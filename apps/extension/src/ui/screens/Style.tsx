import { useEffect, useRef, useState } from "react";
import { MemoryView } from "../components/MemoryView.tsx";
import {
  buildProfile, clearProfile, getOutfitPhotos, saveOutfitPhotos, saveProfile,
  type Answers, type Avatar as AvatarT, type StyleProfile,
} from "../../lib/profile.ts";
import { aiReady, setSettings, type AIProvider } from "../../lib/settings.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Icon, Page, Segmented, Sheet, Switch, transition, useHud, useProfile, useSettings } from "../components/kit.tsx";
import { findPeople, type PersonBox } from "../../lib/ai.ts";
import { googlePhotosAvailable, pickFromGooglePhotos } from "../../lib/gphotos.ts";
import { cropTo } from "../../lib/images.ts";

const PLACEHOLDER: AvatarT = {
  skin: "#d9d4cf", hair: "#b9b3ad", hairStyle: "short", facialHair: "none", glasses: false, build: "average", height: "average",
  top: "#c9c4be", bottom: "#b3ada7", shoes: "#d9d4cf", topStyle: "tee", bottomStyle: "trousers",
};
const SHOP_FOR = ["Work", "Everyday", "Going out", "Ethnic", "Weddings", "Gym", "Travel"];
const BUDGETS = ["Under ₹1,500", "₹1,500 to 3,000", "₹3,000 to 6,000", "₹6,000+"];
const MIN = 3;
const BEST = 5;
const MAX = 20;

type Step = "intro" | "key" | "photos" | "questions" | "building" | "reveal";

/** One outfit photo on its way in. Group photos wait until you tap yourself. */
interface Shot {
  blob: Blob;
  url: string;
  source?: "upload" | "google" | "group";
  state?: "ok" | "checking" | "choose";
  original?: Blob;
  /** preview of the crop, once you are picked out of a group */
  thumb?: string;
  people?: PersonBox[];
  me?: number | null;
}

export function Style({ trailing }: { trailing?: React.ReactNode } = {}) {
  const profile = useProfile();
  // Stay in onboarding until "Start shopping", even after the profile is saved,
  // so the reveal gets its moment.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (profile !== undefined && onboarding === null) setOnboarding(!profile);
  }, [profile]);
  if (profile === undefined || onboarding === null) return null;
  if (onboarding || !profile) return <Onboarding onDone={() => transition(() => setOnboarding(false))} />;
  return <ProfileView p={profile} trailing={trailing} onRedo={() => transition(() => setOnboarding(true))} />;
}

// ---------- onboarding ----------

function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [photos, setPhotos] = useState<Shot[]>([]);
  const [answers, setAnswers] = useState<Answers>({ shopFor: [], useFrame: true });
  const [result, setResult] = useState<StyleProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = (s: Step) => transition(() => setStep(s));
  const settings = useSettings();

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
        <div className="onb-stage"><Avatar a={PLACEHOLDER} size={112} /></div>
        <h1 className="onb-title">Show us outfits you love</h1>
        <p className="onb-sub">Zero Q reads your colours, shapes and taste from them, then scores anything you point at, on any site, for you.</p>
        <ul className="onb-steps">
          <li>3 or more photos: Google Photos, uploads, group shots<span>2 min</span></li>
          <li>Three quick taps<span>30 sec</span></li>
          <li>Your style, read back to you<span>20 sec</span></li>
        </ul>
        <div className="onb-cta"><button className="btn filled block" onClick={() => go(aiReady(settings) ? "photos" : "key")}>Get started</button></div>
      </div>
    );
  }

  if (step === "key") return <KeyStep onBack={() => go("intro")} onNext={() => go("photos")} />;
  if (step === "photos") return <PhotoStep photos={photos} setPhotos={setPhotos} onBack={() => go("intro")} onNext={() => go("questions")} />;

  if (step === "questions") {
    return <QuestionStep answers={answers} setAnswers={setAnswers} err={err} onBack={() => go("photos")} onBuild={build} count={photos.length} />;
  }

  if (step === "building") return <Building photos={photos.map((p) => p.url)} />;

  return result ? <Reveal p={result} onDone={onDone} /> : null;
}

/** Your AI key first, so photos can be checked for group shots as they come in. */
function KeyStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const st = useSettings();
  if (!st) return null;
  return (
    <div className="onb">
      <Back onClick={onBack} />
      <h1 className="onb-title">Connect your AI</h1>
      <p className="onb-sub">Zero Q's eyes. It reads your photos and the clothes you point at.</p>
      <Segmented<AIProvider> label="AI provider" value={st.aiProvider} onChange={(v) => setSettings({ aiProvider: v })}
        options={[{ value: "gemini", label: "Gemini" }, { value: "claude", label: "Claude" }]} />
      <div className="group">
        {st.aiProvider === "gemini" ? (
          <input key="g" className="field" type="password" placeholder="Gemini API key, starts with AIza" autoComplete="off" defaultValue={st.geminiKey} onChange={(e) => setSettings({ geminiKey: e.target.value.trim() })} aria-label="Gemini API key" />
        ) : (
          <input key="c" className="field" type="password" placeholder="Claude API key, starts with sk-ant-" autoComplete="off" defaultValue={st.anthropicKey} onChange={(e) => setSettings({ anthropicKey: e.target.value.trim() })} aria-label="Claude API key" />
        )}
      </div>
      <p className="group-footer">{st.aiProvider === "gemini" ? "Free key at aistudio.google.com/apikey. Turn on billing so Google does not train on your photos." : "Key at console.anthropic.com."} It stays in this browser.</p>
      <div className="onb-cta"><button className="btn filled block" disabled={!aiReady(st)} onClick={onNext}>Continue</button></div>
    </div>
  );
}

function PhotoStep({ photos, setPhotos, onBack, onNext }: { photos: Shot[]; setPhotos: (f: (p: Shot[]) => Shot[]) => void; onBack: () => void; onNext: () => void }) {
  const upload = useRef<HTMLInputElement>(null);
  const group = useRef<HTMLInputElement>(null);
  const hud = useHud();
  const [gp, setGp] = useState<boolean | null>(null);
  const [gpBusy, setGpBusy] = useState<string | null>(null);
  const [who, setWho] = useState<Shot | null>(null);
  useEffect(() => { googlePhotosAvailable().then(setGp); }, []);

  const patch = (url: string, f: (s: Shot) => Shot) => setPhotos((ps) => ps.map((x) => (x.url === url ? f(x) : x)));
  /** Looks for people; more than one means you choose yourself. */
  const check = async (shot: Shot, always: boolean) => {
    patch(shot.url, (x) => ({ ...x, state: "checking" }));
    try {
      const ref = photosRef.current.find((x) => x.state === "ok" && x.url !== shot.url && x.source !== "group");
      const r = await findPeople(shot.original ?? shot.blob, ref?.blob);
      if (r.people.length <= 1 && !always) {
        patch(shot.url, (x) => ({ ...x, state: "ok", people: r.people }));
      } else if (r.people.length === 0) {
        patch(shot.url, (x) => ({ ...x, state: "ok", people: [] }));
        hud("No one found in that photo. Kept it as it is.");
      } else if (r.people.length === 1) {
        const cut = await cropTo(shot.original ?? shot.blob, r.people[0].box);
        patch(shot.url, (x) => ({ ...x, state: "ok", original: x.original ?? x.blob, blob: cut, thumb: URL.createObjectURL(cut), people: r.people, me: 0 }));
      } else {
        patch(shot.url, (x) => ({ ...x, state: "choose", people: r.people, me: r.me }));
      }
    } catch {
      patch(shot.url, (x) => ({ ...x, state: "ok" })); // keep it; the stylist can still read the whole photo
    }
  };
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const add = (blobs: Blob[], source: Shot["source"]) => {
    const room = MAX - photosRef.current.length;
    const take = blobs.filter((b) => b.type.startsWith("image/") || b.type === "").slice(0, room);
    if (blobs.length > room) hud(`Kept ${room}. Up to ${MAX} photos.`);
    const shots: Shot[] = take.map((blob) => ({ blob, url: URL.createObjectURL(blob), source, state: "ok" }));
    setPhotos((p) => [...p, ...shots]);
    // Uploads you call solo are trusted; Google Photos picks and group shots are checked for other people.
    for (const sh of shots) if (source !== "upload") setTimeout(() => check(sh, source === "group"), 0);
  };

  const fromGoogle = async () => {
    try {
      const blobs = await pickFromGooglePhotos(MAX - photos.length, (stage, d, t) =>
        setGpBusy(stage === "signin" ? "Signing in to Google" : stage === "picking" ? "Choose photos in Google Photos" : `Bringing in ${(d ?? 0) + 1} of ${t}`));
      if (blobs.length) add(blobs, "google");
    } catch (e: any) {
      hud(e?.message ?? "Google Photos did not open", "err");
    } finally {
      setGpBusy(null);
    }
  };

  const n = photos.length;
  const waiting = photos.filter((x) => x.state === "choose").length;
  const checking = photos.filter((x) => x.state === "checking").length;
  return (
    <div className="onb">
      <Back onClick={onBack} />
      <h1 className="onb-title">Your best outfits</h1>
      <p className="onb-sub">Head to toe, ones you feel great in. Group photos are fine: you tap yourself.</p>
      <input ref={upload} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && add(Array.from(e.target.files), "upload"); e.target.value = ""; }} />
      <input ref={group} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && add(Array.from(e.target.files), "group"); e.target.value = ""; }} />

      <div className="sources" role="group" aria-label="Add photos from">
        {gp !== false && (
          <button className="source" onClick={fromGoogle} disabled={!!gpBusy || n >= MAX || gp === null}>
            <span className="src-ic g"><Icon.photos /></span><b>Google Photos</b><small>{gpBusy ?? "Search “me”, pick"}</small>
          </button>
        )}
        <button className="source" onClick={() => upload.current?.click()} disabled={n >= MAX}>
          <span className="src-ic"><Icon.upload /></span><b>Upload</b><small>Photos of you</small>
        </button>
        <button className="source" onClick={() => group.current?.click()} disabled={n >= MAX}>
          <span className="src-ic"><Icon.group /></span><b>Group photo</b><small>Great outfit, others in it</small>
        </button>
      </div>
      {gp === false && typeof chrome.identity?.launchWebAuthFlow === "function" && (
        <p className="hint" style={{ margin: "-6px 4px 14px" }}>Google Photos needs a Google client ID in Settings while Zero Q is in testing.</p>
      )}

      <div className="shots" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(Array.from(e.dataTransfer.files), "upload"); }}>
        {photos.map((x, i) => (
          <div className={`shot ${x.state ?? "ok"}`} key={x.url}>
            <img src={x.thumb ?? x.url} alt={`Outfit ${i + 1}`} />
            {x.source === "google" && <span className="shot-src" aria-label="From Google Photos"><Icon.photos /></span>}
            {x.source === "group" || (x.people?.length ?? 0) > 1 ? <span className="shot-src" aria-label="Group photo"><Icon.group /></span> : null}
            {x.state === "checking" && <span className="shot-over"><i className="spin" />Finding you</span>}
            {x.state === "choose" && <button className="shot-over choose" onClick={() => setWho(x)}><Icon.face />Tap to pick you</button>}
            <button className="slot-x" aria-label={`Remove outfit ${i + 1}`} onClick={() => setPhotos((p) => p.filter((y) => y.url !== x.url))}>✕</button>
          </div>
        ))}
        {n < MAX && (
          <button className="shot add" onClick={() => upload.current?.click()} aria-label="Add outfit photo"><Icon.plus /></button>
        )}
      </div>
      <div className="slot-count">
        <span className="hint">{n < MIN ? `Add at least ${MIN - n} more` : waiting ? `Tap yourself in ${waiting} group ${waiting === 1 ? "photo" : "photos"}` : checking ? "Checking photos" : n < BEST ? `${BEST} or more reads best` : "Looking good"}</span>
        <b>{n}<span className="faint"> / {MAX}</span></b>
      </div>
      <div className="onb-cta"><button className="btn filled block" disabled={n < MIN || waiting > 0 || checking > 0} onClick={onNext}>Continue</button></div>
      <WhoSheet shot={who} onClose={() => setWho(null)} onPick={async (i) => {
        const x = who!;
        setWho(null);
        if (i == null) return setPhotos((p) => p.filter((y) => y.url !== x.url));
        const cut = await cropTo(x.original ?? x.blob, x.people![i].box);
        patch(x.url, (y) => ({ ...y, state: "ok", original: y.original ?? y.blob, blob: cut, thumb: URL.createObjectURL(cut), me: i }));
      }} />
    </div>
  );
}

/** A group photo with a ring on each person: tap the one that is you. */
function WhoSheet({ shot, onClose, onPick }: { shot: Shot | null; onClose: () => void; onPick: (i: number | null) => void }) {
  return (
    <Sheet open={!!shot} onClose={onClose} title="Which one is you?">
      {shot && (
        <div className="who">
          <div className="who-photo">
            <img src={shot.url} alt="Group photo" />
            {shot.people?.map((p, i) => (
              <button key={i} className={`who-box ${shot.me === i ? "guess" : ""}`} aria-label={`Person ${i + 1}${shot.me === i ? ", probably you" : ""}`}
                style={{ left: `${p.box[0] * 100}%`, top: `${p.box[1] * 100}%`, width: `${(p.box[2] - p.box[0]) * 100}%`, height: `${(p.box[3] - p.box[1]) * 100}%` }}
                onClick={() => onPick(i)}>
                <span>{shot.me === i ? "You?" : i + 1}</span>
              </button>
            ))}
          </div>
          <p className="hint center">Zero Q crops to you and reads only your outfit.</p>
          <button className="btn plain small block" onClick={() => onPick(null)}>I'm not in this one</button>
        </div>
      )}
    </Sheet>
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

      {st && !aiReady(st) && (
        <>
          <div className="group-header">Your AI key</div>
          <Segmented<AIProvider> label="AI provider" value={st.aiProvider} onChange={(v) => setSettings({ aiProvider: v })}
            options={[{ value: "gemini", label: "Gemini" }, { value: "claude", label: "Claude" }]} />
          <div className="group">
            {st.aiProvider === "gemini" ? (
              <input key="g" className="field" type="password" placeholder="Gemini API key, starts with AIza" autoComplete="off" onChange={(e) => setSettings({ geminiKey: e.target.value.trim() })} aria-label="Gemini API key" />
            ) : (
              <input key="c" className="field" type="password" placeholder="Claude API key, starts with sk-ant-" autoComplete="off" onChange={(e) => setSettings({ anthropicKey: e.target.value.trim() })} aria-label="Claude API key" />
            )}
          </div>
          <p className="group-footer">{st.aiProvider === "gemini"
            ? "Gemini reads your photos. Get a key at aistudio.google.com/apikey and turn on billing, so Google does not use your photos for training. The key stays in this browser."
            : "Claude reads your photos. Get a key at console.anthropic.com. The key stays in this browser."}</p>
        </>
      )}
      {err && <p className="error">{err}</p>}
      <div className="onb-cta"><button className="btn filled block" disabled={!aiReady(st)} onClick={onBuild}>Read my {count} outfits</button></div>
    </div>
  );
}

const LINES = ["Looking at each outfit", "Finding the colours that suit you", "Spotting what you keep choosing", "Reading your silhouette", "Drawing your character"];

function Building({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(LINES.length - 1, x + 1)), 3200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="onb building" aria-live="polite">
      <div className="fan" aria-hidden>
        {photos.map((u, k) => <img key={u} src={u} alt="" className={k === i % photos.length ? "reading" : ""} style={{ "--k": k - (photos.length - 1) / 2 } as any} />)}
      </div>
      <h1 className="onb-title">Reading your outfits</h1>
      <ul className="building-steps">
        {LINES.map((l, k) => <li key={l} className={k < i ? "done" : k === i ? "now" : ""}><i />{l}</li>)}
      </ul>
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
      <div className="onb-stage">
        <Avatar a={p.avatar} mood={mood} size={128} />
      </div>
      <h1 className="onb-title">{p.styleName}</h1>
      <p className="onb-sub">{p.summary}</p>
      <PaletteBand p={p} />
      <ProfileDetails p={p} />
      <div className="onb-cta"><button className="btn filled block" onClick={onDone}>Start shopping</button></div>
      <p className="hint" style={{ margin: "0 0 20px" }}>On any site, right-click a photo and choose Rate this for me, or press <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>X</kbd> and click it.</p>
    </div>
  );
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
    <Page title="You" trailing={trailing}>
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

function Back({ onClick }: { onClick: () => void }) {
  return <button className="btn plain back" onClick={onClick}>‹ Back</button>;
}
