import { useEffect, useRef, useState, type ReactNode } from "react";
import { findPeople, type PersonBox } from "../../lib/ai.ts";
import { canPickFolder, canSaveToDownloads, chooseFolder, saveToDownloads } from "../../lib/folder.ts";
import { googlePhotosAvailable, pickFromGooglePhotos } from "../../lib/gphotos.ts";
import { cropTo } from "../../lib/images.ts";
import { buildProfile, getOutfitPhotos, saveOutfitPhotos, saveProfile, type Answers, type StyleProfile } from "../../lib/profile.ts";
import { aiReady, setSettings, type AIProvider } from "../../lib/settings.ts";
import { detectOS, downloadsFolder, suggestedFolder } from "../../lib/where.ts";
import { Flat, backdropOf, type FlatKind } from "../components/Flat.tsx";
import { Icon, Segmented, Sheet, Switch, transition, useHud, useSettings } from "../components/kit.tsx";

/**
 * Setup. Opens as a full page in a tab when the extension is installed, and
 * the same screens stack into one column inside the side panel.
 * Four steps: connect, photos, taste, your label.
 */
const STEPS = ["Connect", "Photos", "Taste", "Label"];
const SHOP_FOR = ["Work", "Everyday", "Going out", "Ethnic", "Weddings", "Gym", "Travel"];
const BUDGETS = ["Under ₹1,500", "₹1,500 to 3,000", "₹3,000 to 6,000", "₹6,000+"];
const LOOKS: Array<{ name: string; top: FlatKind; topc: string; botc: string }> = [
  { name: "Earthy layers", top: "shirt", topc: "#b9714c", botc: "#d6c4a0" },
  { name: "Clean basics", top: "tee", topc: "#ffffff", botc: "#2f3b5c" },
  { name: "Street", top: "tee", topc: "#3a3b40", botc: "#7c8a5a" },
  { name: "Smart casual", top: "shirt", topc: "#a9bedd", botc: "#6f747c" },
  { name: "Festive", top: "kurta", topc: "#8a3f4c", botc: "#ede7da" },
  { name: "Sporty", top: "polo", topc: "#4e8f88", botc: "#3a3b40" },
];
const TOP_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const WAIST_SIZES = ["26", "28", "30", "32", "34", "36", "38", "40"];
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

function Shell({ step, title, lead, actions, children, hero }: { step: number; title: string; lead: ReactNode; actions?: ReactNode; children: ReactNode; hero?: boolean }) {
  return (
    <div className="su">
      <header className="su-head">
        <div className="su-brand">Zero Q</div>
        <ol className="su-steps" aria-label="Setup steps">
          {STEPS.map((n, i) => (
            <li key={n} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""} aria-current={i + 1 === step ? "step" : undefined}>
              {i + 1 < step && <Icon.tick />}{n}{i + 1 < step && <span className="sr-only"> done</span>}
            </li>
          ))}
        </ol>
      </header>
      <div className="su-main">
        <div className="su-left">
          {step > 0 && !hero && <div className="su-count">Step {step} of 4</div>}
          <h1 className={hero ? "su-hero" : "su-title"}>{title}</h1>
          <p className="su-lead">{lead}</p>
          {actions && <div className="su-actions">{actions}</div>}
        </div>
        <div className="su-right">{children}</div>
      </div>
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [photos, setPhotos] = useState<Shot[]>([]);
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

  if (step === "intro") return <Welcome onNext={() => go("key")} />;
  if (step === "key") return <ConnectStep onBack={() => go("intro")} onNext={() => go("photos")} />;
  if (step === "photos") return <PhotoStep photos={photos} setPhotos={setPhotos} onBack={() => go("key")} onNext={() => go("questions")} />;
  if (step === "questions") return <TasteStep answers={answers} setAnswers={setAnswers} err={err} onBack={() => go("photos")} onBuild={build} count={photos.length} />;
  if (step === "building") return <Building photos={photos.map((p) => p.thumb ?? p.url)} />;
  return result ? <LabelStep p={result} onDone={onDone} /> : null;
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <Shell step={0} hero title="Should I buy this?"
      lead="Zero Q checks any piece on any store against your body, your colours, your budget and the clothes you already own. Then it answers."
      actions={<><button className="btn filled big" onClick={onNext}>Set up Zero Q</button><span className="su-note">About 2 minutes</span></>}>
      <div className="su-collage" aria-hidden>
        <div className="sc sc-b" style={{ background: "var(--butter)" }}><Flat kind="pants" fill="#d6c4a0" /></div>
        <div className="sc sc-c" style={{ background: "var(--lav)" }}><Flat kind="shoe" fill="#ffffff" /></div>
        <div className="sc sc-a" style={{ background: backdropOf("#b9714c") }}><Flat kind="shirt" fill="#b9714c" /></div>
        <div className="sc-v"><span>91</span><em>Buy it</em></div>
      </div>
      <p className="su-fine">Your photos stay on this device and are shown only to the AI you connect.</p>
    </Shell>
  );
}

/** Your AI key and where your data lives. The key comes first so group photos can be checked as they come in. */
function ConnectStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const st = useSettings();
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const os = detectOS();
  const home = st.dataHome === "unset" ? "browser" : st.dataHome;
  const pick = async (v: "browser" | "folder" | "downloads") => {
    if (busy) return;
    setBusy(true);
    try {
      if (v === "folder") { await chooseFolder(); await setSettings({ dataHome: "folder" }); }
      else if (v === "downloads") { await saveToDownloads(); await setSettings({ dataHome: "downloads" }); }
      else await setSettings({ dataHome: "browser" });
    } catch (e: any) {
      if (e?.name !== "AbortError") hud(e?.message ?? "Could not use that folder", "err");
    } finally {
      setBusy(false);
    }
  };
  const next = async () => { if (st.dataHome === "unset") await setSettings({ dataHome: "browser" }); onNext(); };
  const Opt = ({ v, title, text, ic }: { v: "browser" | "folder" | "downloads"; title: string; text: string; ic: ReactNode }) => (
    <label className={`su-opt ${home === v ? "on" : ""}`}>
      <input type="radio" name="home" checked={home === v} onChange={() => pick(v)} />
      <span className="grow"><b>{title}</b><span>{text}</span></span>{ic}
    </label>
  );
  return (
    <Shell step={1} title="Two quick choices" lead="An AI key so Zero Q can see, and a place to keep your data. Both stay under your control."
      actions={<><button className="btn filled" disabled={!aiReady(st)} onClick={next}>Continue</button><button className="btn plain" onClick={onBack}>Back</button></>}>
      <div className="su-cards">
        <section className="su-card tint-lav" aria-labelledby="su-key">
          <h2 id="su-key">Your AI key</h2>
          <Segmented<AIProvider> label="AI provider" value={st.aiProvider} onChange={(v) => setSettings({ aiProvider: v })} options={[{ value: "gemini", label: "Gemini" }, { value: "claude", label: "Claude" }]} />
          {st.aiProvider === "gemini" ? (
            <ol className="su-how">
              <li><i>1</i><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Open Google AI Studio</a></li>
              <li><i>2</i>Press Create API key and copy it</li>
              <li><i>3</i>Paste it here</li>
            </ol>
          ) : (
            <ol className="su-how">
              <li><i>1</i><a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">Open the Claude console</a></li>
              <li><i>2</i>Create an API key and copy it</li>
              <li><i>3</i>Paste it here</li>
            </ol>
          )}
          <label className="su-field">
            <span>{st.aiProvider === "gemini" ? "Gemini API key" : "Claude API key"}</span>
            {st.aiProvider === "gemini"
              ? <input key="g" type="password" placeholder="Starts with AIza" autoComplete="off" defaultValue={st.geminiKey} onChange={(e) => setSettings({ geminiKey: e.target.value.trim() })} />
              : <input key="c" type="password" placeholder="Starts with sk-ant-" autoComplete="off" defaultValue={st.anthropicKey} onChange={(e) => setSettings({ anthropicKey: e.target.value.trim() })} />}
          </label>
          <p className="su-ok" role="status">{aiReady(st) ? <><Icon.tick />Key added. It stays in this browser.</> : st.aiProvider === "gemini" ? "A personal key is free. Turn on billing so Google does not train on your photos." : "The key stays in this browser."}</p>
        </section>
        <section className="su-card" aria-labelledby="su-home">
          <h2 id="su-home">Where your data lives</h2>
          <p className="su-sub">Photos, wardrobe and history. You can change this later in Me.</p>
          <div role="radiogroup" aria-labelledby="su-home" className="su-opts">
            <Opt v="browser" title="This browser" text="Nothing to set up. Lost if you remove the extension." ic={<Icon.expand />} />
            {canPickFolder() && <Opt v="folder" title="A folder on this computer" text={`Survives a reinstall. A good place: ${suggestedFolder(os)}`} ic={<Icon.copy />} />}
            {!canPickFolder() && canSaveToDownloads() && <Opt v="downloads" title="A daily copy in Downloads" text={downloadsFolder(os)} ic={<Icon.copy />} />}
          </div>
          <p className="su-sub">Google Drive sync can be turned on later in Me.</p>
        </section>
      </div>
    </Shell>
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
    <Shell step={2} title="Add a few photos of you" lead="Full-length photos work best. Zero Q reads your build, your skin tone and the outfits that already look good on you."
      actions={<><button className="btn filled" disabled={n < MIN || waiting > 0 || checking > 0} onClick={onNext}>Continue</button><button className="btn plain" onClick={onBack}>Back</button></>}>
      <div className="su-card">
      <input ref={upload} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && add(Array.from(e.target.files), "upload"); e.target.value = ""; }} />
      <input ref={group} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && add(Array.from(e.target.files), "group"); e.target.value = ""; }} />

      <div className="sources" role="group" aria-label="Add photos from">
        {gp !== false && (
          <button className="source" onClick={fromGoogle} disabled={!!gpBusy || n >= MAX || gp === null}>
            <span className="src-ic g"><Icon.photos /></span><b>Google Photos</b><small>{gpBusy ?? "Pick from your library"}</small>
          </button>
        )}
        <button className="source" onClick={() => upload.current?.click()} disabled={n >= MAX}>
          <span className="src-ic"><Icon.upload /></span><b>Upload</b><small>Or drop files here</small>
        </button>
        <button className="source" onClick={() => group.current?.click()} disabled={n >= MAX}>
          <span className="src-ic"><Icon.group /></span><b>A group photo</b><small>Tap yourself, we crop</small>
        </button>
      </div>
      {gp === false && typeof chrome.identity?.launchWebAuthFlow === "function" && (
        <p className="hint">Google Photos needs a Google client ID in Settings while Zero Q is in testing.</p>
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
      </div>
      <WhoSheet shot={who} onClose={() => setWho(null)} onPick={async (i) => {
        const x = who!;
        setWho(null);
        if (i == null) return setPhotos((p) => p.filter((y) => y.url !== x.url));
        const cut = await cropTo(x.original ?? x.blob, x.people![i].box);
        patch(x.url, (y) => ({ ...y, state: "ok", original: y.original ?? y.blob, blob: cut, thumb: URL.createObjectURL(cut), me: i }));
      }} />
    </Shell>
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


function TasteStep({ answers, setAnswers, err, onBack, onBuild, count }: { answers: Answers; setAnswers: (a: Answers) => void; err: string | null; onBack: () => void; onBuild: () => void; count: number }) {
  const st = useSettings();
  const flip = (key: "shopFor" | "looks", s: string) => { const cur = answers[key] ?? []; setAnswers({ ...answers, [key]: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] }); };
  const size = (k: "top" | "bottom", v: string) => setAnswers({ ...answers, sizes: { ...answers.sizes, [k]: answers.sizes?.[k] === v ? undefined : v } });
  return (
    <Shell step={3} title="Tap what you would wear" lead="A few taps so the advice fits your life, not just your photos. Zero Q learns the rest from what you search and buy."
      actions={<><button className="btn filled" disabled={!aiReady(st)} onClick={onBuild}>Read my {count} photos</button><button className="btn plain" onClick={onBack}>Back</button></>}>
      <div className="su-card">
        <div className="su-looks" role="group" aria-label="Looks you would wear">
          {LOOKS.map((l) => {
            const on = answers.looks?.includes(l.name) ?? false;
            return (
              <button key={l.name} className="su-look" aria-pressed={on} onClick={() => flip("looks", l.name)} style={{ background: backdropOf(l.topc) === "var(--surface)" ? "var(--raised)" : backdropOf(l.topc) }}>
                {on && <span className="su-tick"><Icon.tick /></span>}
                <span className="su-top"><Flat kind={l.top} fill={l.topc} /></span>
                <span className="su-bot"><Flat kind="pants" fill={l.botc} /></span>
                <b>{l.name}</b>
              </button>
            );
          })}
        </div>
        <fieldset className="su-q"><legend>What do you shop for most?</legend>
          <div className="chips wrap">{SHOP_FOR.map((s) => <button key={s} className="chip" aria-pressed={answers.shopFor.includes(s)} onClick={() => flip("shopFor", s)}>{s}</button>)}</div>
        </fieldset>
        <fieldset className="su-q"><legend>The most you usually spend on one piece</legend>
          <div className="chips wrap">{BUDGETS.map((b) => <button key={b} className="chip" aria-pressed={answers.budget === b} onClick={() => setAnswers({ ...answers, budget: b })}>{b}</button>)}</div>
        </fieldset>
        <fieldset className="su-q"><legend>Your usual sizes, so Zero Q can tell you when yours is in stock</legend>
          <div className="chips wrap" role="group" aria-label="Top size">{TOP_SIZES.map((s) => <button key={s} className="chip" aria-pressed={answers.sizes?.top === s} onClick={() => size("top", s)}>{s}</button>)}</div>
          <div className="chips wrap" role="group" aria-label="Waist size">{WAIST_SIZES.map((s) => <button key={s} className="chip" aria-pressed={answers.sizes?.bottom === s} onClick={() => size("bottom", s)}>{s}</button>)}</div>
        </fieldset>
        <label className="su-field"><span>Anything you never wear?</span>
          <input placeholder="For example skinny jeans, neon, big logos" value={answers.never ?? ""} onChange={(e) => setAnswers({ ...answers, never: e.target.value })} />
        </label>
        <div className="su-switch">
          <span className="grow"><b>Use my build in advice</b><span>Zero Q reads your frame from the photos to suggest cuts that flatter it. It never asks or judges.</span></span>
          <Switch on={answers.useFrame} onChange={(v) => setAnswers({ ...answers, useFrame: v })} label="Use my build in advice" />
        </div>
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </Shell>
  );
}

const LINES = ["Looking at each photo", "Finding the colours that suit you", "Spotting what you keep choosing", "Reading your silhouette", "Writing your label"];

function Building({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(LINES.length - 1, x + 1)), 3200);
    return () => clearInterval(t);
  }, []);
  return (
    <Shell step={4} title="Reading your photos" lead="This takes about 20 seconds. Keep this page open.">
      <div className="su-card building" aria-live="polite">
        <div className="fan" aria-hidden>
          {photos.slice(0, 7).map((u, k, all) => <img key={u} src={u} alt="" className={k === i % all.length ? "reading" : ""} style={{ "--k": k - (all.length - 1) / 2 } as any} />)}
        </div>
        <ul className="building-steps">
          {LINES.map((l, k) => <li key={l} className={k < i ? "done" : k === i ? "now" : ""}><i />{l}</li>)}
        </ul>
      </div>
    </Shell>
  );
}

const STORE_HOMES: Array<[string, string]> = [["Myntra", "https://www.myntra.com"], ["Ajio", "https://www.ajio.com"], ["Amazon", "https://www.amazon.in"], ["Flipkart", "https://www.flipkart.com"]];

/** Your style on one card, then the three things to do next. */
function LabelStep({ p, onDone }: { p: StyleProfile; onDone: () => void }) {
  const sizes = [p.answers.sizes?.top, p.answers.sizes?.bottom && `waist ${p.answers.sizes.bottom}`].filter(Boolean).join(", ");
  const rows: Array<[string, string | undefined]> = [
    ["Colours", `${p.undertone.charAt(0).toUpperCase()}${p.undertone.slice(1)} undertone: ${p.palette.best.slice(0, 4).map((s) => s.name.toLowerCase()).join(", ")}`],
    ["Build", p.answers.useFrame ? p.frame : undefined],
    ["Fits", p.fits.join(", ")],
    ["Sizes", sizes],
    ["Budget", p.answers.budget ? `${p.answers.budget} a piece` : undefined],
    ["Never", p.answers.never],
  ];
  return (
    <Shell step={4} title="Your label is ready" lead="This is what every piece gets checked against. Change it any time in Me."
      actions={<button className="btn filled" onClick={onDone}>Start shopping</button>}>
      <div className="su-cards">
        <section className="su-card tint-sage label-card" aria-labelledby="su-label">
          <h2 id="su-label">{p.styleName}</h2>
          <div className="label-sw" aria-label={`Your colours: ${p.palette.best.map((s) => s.name).join(", ")}`}>{p.palette.best.map((s) => <i key={s.hex + s.name} style={{ background: s.hex }} title={s.name} />)}</div>
          <p className="label-sum">{p.summary}</p>
          <dl className="label-rows">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </section>
        <section className="su-card" aria-labelledby="su-try">
          <h2 id="su-try">Now try it</h2>
          <ol className="su-next">
            <li><span className="su-ic"><Icon.target /></span><div><b>Pin Zero Q</b><p>Click the puzzle icon in your toolbar, then the pin next to Zero Q.</p></div></li>
            <li><span className="su-ic"><Icon.store /></span><div><b>Open a store</b><p>Any store works. These are a good start.</p>
              <div className="chips wrap">{STORE_HOMES.map(([n, u]) => <a key={n} className="chip" href={u} target="_blank" rel="noopener noreferrer">{n}</a>)}</div></div></li>
            <li><span className="su-ic"><Icon.sparkle /></span><div><b>Ask on any piece</b><p>Click Zero Q on a product page, or right-click any photo and choose Rate this for me.</p></div></li>
          </ol>
        </section>
      </div>
    </Shell>
  );
}
