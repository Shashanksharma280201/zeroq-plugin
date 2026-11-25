import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bodyBox, findMe, portraitBox, tileZoom, type Face } from "@zq/core";
import { readFaces, stopFaces, warmFaces } from "../../lib/faces.ts";
import { canPickFolder, canSaveToDownloads, chooseFolder, saveToDownloads } from "../../lib/folder.ts";
import { pickFromGooglePhotos } from "../../lib/gphotos.ts";
import { OFF, onCollect, onInbox, startCollect, stopCollect, takeInbox } from "../../lib/collect.ts";
import type { CollectState } from "../../lib/messages.ts";
import { usePhotosStatus } from "../components/GooglePhotos.tsx";
import { cropTo, hashBlob } from "../../lib/images.ts";
import { buildProfile, getOutfitPhotos, saveOutfitPhotos, saveProfile, type Answers, type StyleProfile } from "../../lib/profile.ts";
import { aiReady, setSettings, type AIProvider } from "../../lib/settings.ts";
import { detectOS, downloadsFolder, suggestedFolder } from "../../lib/where.ts";
import { PORTRAIT_KEY } from "../components/MePhoto.tsx";
import { deleteBlob, putBlob } from "../../lib/db.ts";
import { Icon, Segmented, Sheet, Switch, transition, useHud, useSettings } from "../components/kit.tsx";

/**
 * Setup. Opens as a full page in a tab when the extension is installed, and
 * the same screens stack into one column inside the side panel.
 * Four steps: connect, photos, taste, your label.
 */
const STEPS = ["Connect", "Photos", "Taste", "Label"];
const SHOP_FOR = ["Work", "Everyday", "Going out", "Ethnic", "Weddings", "Gym", "Travel"];
const BUDGETS = ["Under ₹1,500", "₹1,500 to 3,000", "₹3,000 to 6,000", "₹6,000+"];
/** Ways of dressing, shown as the colours each one lives in. No drawings: the real clothes come from your photos. */
const LOOKS: Array<{ name: string; says: string; shades: string[] }> = [
  { name: "Earthy layers", says: "Overshirts, linen, warm tones", shades: ["#b9714c", "#6b7340", "#d6c4a0", "#7a5232"] },
  { name: "Clean basics", says: "Plain tees, dark denim", shades: ["#f5f5f2", "#2f3b5c", "#8a8a8a", "#1b1b1b"] },
  { name: "Street", says: "Oversized, cargos, sneakers", shades: ["#3a3b40", "#7c8a5a", "#e9e6df", "#c4302b"] },
  { name: "Smart casual", says: "Oxford shirts, chinos", shades: ["#a9bedd", "#1f2a52", "#cdb994", "#6f747c"] },
  { name: "Festive", says: "Kurtas, rich colour", shades: ["#8a3f4c", "#c8a24a", "#1b6e66", "#ede7da"] },
  { name: "Sporty", says: "Polos, joggers, trainers", shades: ["#4e8f88", "#3a3b40", "#f5f5f2", "#ec7a2a"] },
];
const TOP_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const WAIST_SIZES = ["26", "28", "30", "32", "34", "36", "38", "40"];
const MIN = 3;
const BEST = 5;
const MAX = 20;

type Step = "intro" | "key" | "photos" | "questions" | "building" | "reveal";

/** One outfit photo on its way in. */
interface Shot {
  /** what the stylist reads: the whole photo, or you cropped out of a group photo */
  blob: Blob;
  /** preview of the photo as it was added; also how the photo is told apart from the others */
  url: string;
  source?: "upload" | "google";
  /** the photo as added, kept once a crop has taken its place in `blob` */
  original?: Blob;
  /** preview of the crop */
  thumb?: string;
  /** so the same file is not added twice */
  hash?: string;
  /** the clear faces in the photo, largest first. Not set while it is being read; null when it could not be read. */
  faces?: Face[] | null;
  w?: number;
  h?: number;
  /** the face you tapped as yourself */
  picked?: number;
  /** the face the crop was made around */
  me?: number;
  /** on while the find-and-zoom plays */
  found?: boolean;
  /** set when the photo was tapped on a web page, so un-tapping it there removes it here */
  inboxId?: string;
  /** just arrived: it gets a small entrance */
  fresh?: number;
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
    return stopFaces; // the face models are only needed while photos are being added
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
      <ul className="su-facts">
        <li className="f-sage"><Icon.photos /><div><b>Your photos stay on this device.</b><p>Only the AI you connect sees a photo, and only to read it.</p></div></li>
        <li className="f-butter"><Icon.check /><div><b>Every answer shows its reasons.</b><p>Your colours, your budget, what you own, what buyers say.</p></div></li>
        <li className="f-lav"><Icon.person /><div><b>No account. Nothing to sign up for.</b><p>Your data lives in this browser, or in a folder you choose.</p></div></li>
      </ul>
    </Shell>
  );
}

/** Your AI key and where your data lives. */
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

const TILE = 3 / 4;
/** A crop of you is tall and narrow. Its tile shows the head end, not the middle. Matches .shot img.cut in the styles. */
const HEAD = 0.12;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Photos of you. Everything goes in the same way: drop, paste, choose, or tap
 * them in Google Photos. Each photo's faces are read on this device. Photos of
 * just you teach Zero Q your face; group photos are then cropped to you on
 * their own, and you are only asked when it is not clear.
 */
function PhotoStep({ photos, setPhotos, onBack, onNext }: { photos: Shot[]; setPhotos: (f: (p: Shot[]) => Shot[]) => void; onBack: () => void; onNext: () => void }) {
  const upload = useRef<HTMLInputElement>(null);
  const hud = useHud();
  const gp = usePhotosStatus();
  const [collect, setCollect] = useState<CollectState>(OFF);
  const [gpBusy, setGpBusy] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [portrait, setPortrait] = useState<{ key: string; url: string } | null>(null);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  const patch = (url: string, f: (s: Shot) => Shot) => setPhotos((ps) => ps.map((x) => (x.url === url ? f(x) : x)));

  const add = async (blobs: Blob[], source: Shot["source"], ids?: string[]) => {
    const have = new Set(photosRef.current.map((x) => x.hash).filter(Boolean));
    const shots: Shot[] = [];
    let same = 0, unread = 0;
    for (const blob of blobs) {
      if (!(blob.type.startsWith("image/") || blob.type === "")) { unread++; continue; }
      const hash = await hashBlob(blob).catch(() => undefined);
      if (hash && have.has(hash)) { same++; continue; }
      try { (await createImageBitmap(blob)).close(); } catch { unread++; continue; }
      if (hash) have.add(hash);
      shots.push({ blob, url: URL.createObjectURL(blob), source, hash, inboxId: ids?.[blobs.indexOf(blob)], fresh: shots.length });
    }
    const room = Math.max(0, MAX - photosRef.current.length);
    if (shots.length) setPhotos((p) => [...p, ...shots.slice(0, Math.max(0, MAX - p.length))]);
    const notes = [
      shots.length > room && `Kept ${room}. Up to ${MAX} photos.`,
      same > 0 && `${same === 1 ? "One was" : `${same} were`} already here.`,
      unread > 0 && `${unread === 1 ? "One file" : `${unread} files`} could not be opened. JPG, PNG and WebP work.`,
    ].filter(Boolean);
    if (notes.length) hud(notes.join(" "), unread > 0 && !shots.length ? "err" : undefined);
  };
  const addRef = useRef(add);
  addRef.current = add;

  // Read the faces in every photo that has not been read yet, including ones kept from an earlier setup.
  const queued = useRef(new Set<string>());
  useEffect(() => { warmFaces(); }, []);
  useEffect(() => {
    for (const x of photos) {
      if (x.faces !== undefined || queued.current.has(x.url)) continue;
      queued.current.add(x.url);
      readFaces(x.blob).then((r) => patch(x.url, (y) => ({ ...y, faces: r ? r.faces : null, w: r?.w, h: r?.h })));
    }
  }, [photos]);

  // Who is you in each photo, going by every face read so far and every tap.
  const found = useMemo(() => findMe(photos.filter((x) => x.faces).map((x) => ({ id: x.url, faces: x.faces!, picked: x.picked }))), [photos]);
  const verdicts = useMemo(() => new Map(found.verdicts.map((v) => [v.id, v])), [found]);

  // Crop group photos to you once it is clear which person you are. A photo of just you stays whole.
  const cropping = useRef(new Set<string>());
  useEffect(() => {
    for (const x of photos) {
      const v = verdicts.get(x.url);
      if (!v || !x.faces || !x.w || !x.h || cropping.current.has(x.url)) continue;
      const want = v.settled && v.me != null && x.faces.length > 1 && (v.kind === "group" || v.why === "picked") ? v.me : undefined;
      if (want === x.me) continue;
      cropping.current.add(x.url);
      (async () => {
        try {
          if (want === undefined) return patch(x.url, (y) => ({ ...y, blob: y.original ?? y.blob, original: undefined, thumb: undefined, me: undefined, found: false }));
          const whole = x.original ?? x.blob;
          const cut = await cropTo(whole, bodyBox(x.faces![want], x.faces!, x.w! / x.h!), 0);
          patch(x.url, (y) => ({ ...y, original: whole, blob: cut, thumb: URL.createObjectURL(cut), me: want, found: !reducedMotion() }));
        } catch {
          patch(x.url, (y) => ({ ...y, me: want })); // could not crop: keep the whole photo
        } finally {
          cropping.current.delete(x.url);
        }
      })();
    }
  }, [photos, verdicts]);

  // A small picture of the face Zero Q knows you by.
  const pKey = found.portrait ? `${found.portrait.id}#${found.portrait.index}` : null;
  useEffect(() => {
    if (!pKey || !found.portrait) {
      // every photo read and no face in any of them: no picture of you to keep
      if (photosRef.current.length && photosRef.current.every((y) => y.faces !== undefined)) deleteBlob(PORTRAIT_KEY);
      return setPortrait(null);
    }
    const x = photosRef.current.find((y) => y.url === found.portrait!.id);
    const f = x?.faces?.[found.portrait.index];
    if (!x || !f || !x.w || !x.h) return;
    let live = true;
    cropTo(x.original ?? x.blob, portraitBox(f, x.w / x.h), 0).then((b) => {
      if (!live) return;
      setPortrait({ key: pKey, url: URL.createObjectURL(b) });
      putBlob(PORTRAIT_KEY, b); // the picture of you used across Zero Q: a real photo, not a drawing
    }).catch(() => {});
    return () => { live = false; };
  }, [pKey]);

  // Drop photos anywhere on the page, or paste them.
  useEffect(() => {
    let depth = 0;
    const files = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => { if (files(e)) { depth++; setDragging(true); } };
    const over = (e: DragEvent) => { if (files(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setDragging(false); } };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addRef.current(Array.from(e.dataTransfer!.files), "upload");
    };
    const paste = (e: ClipboardEvent) => {
      const fs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (fs.length) { e.preventDefault(); addRef.current(fs, "upload"); }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, []);

  // Photos tapped on a web page (Google Photos, Instagram, anywhere) land here as they are tapped.
  useEffect(() => onCollect(setCollect), []);
  useEffect(() => onInbox(async () => {
    const { photos: fresh, gone } = await takeInbox();
    if (fresh.length) addRef.current(fresh.map((p) => p.blob), "google", fresh.map((p) => p.id));
    if (gone.length) setPhotos((ps) => ps.filter((x) => !x.inboxId || !gone.includes(x.inboxId)));
  }), []);
  const fromWeb = () => (collect.on ? stopCollect() : startCollect("https://photos.google.com/", MAX - photosRef.current.length));

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
  const reading = photos.filter((x) => x.faces === undefined).length;
  const asks = photos.filter((x) => verdicts.get(x.url)?.settled === false);
  const noRef = asks.some((x) => verdicts.get(x.url)!.why === "no-reference");
  const cropped = photos.filter((x) => x.me != null).length;
  const blind = n > 0 && !reading && photos.every((x) => x.faces === null);
  const asking = who ? photos.find((x) => x.url === who) ?? null : null;
  const status = reading ? `Looking at ${reading === 1 ? "a photo" : `${reading} photos`}`
    : noRef ? "Tap yourself in one group photo"
    : asks.length ? `Check ${asks.length === 1 ? "one photo" : `${asks.length} photos`}`
    : n < MIN ? `Add at least ${MIN - n} more`
    : n < BEST ? `${BEST} or more reads best` : "Looking good";

  return (
    <Shell step={2} title="Add photos of you" lead="Solo or with friends, add them all. Zero Q finds you in each one, then reads your build, your skin tone and the outfits that already suit you."
      actions={<><button className="btn filled" disabled={n < MIN || asks.length > 0 || reading > 0} onClick={onNext}>Continue</button><button className="btn plain" onClick={onBack}>Back</button></>}>
      <div className="su-card">
        <input ref={upload} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && add(Array.from(e.target.files), "upload"); e.target.value = ""; }} />

        {n === 0 && (
          <button className="dropzone" onClick={() => upload.current?.click()}>
            <span className="dz-stack" aria-hidden><i /><i /><i><Icon.person /></i></span>
            <b>Drop your photos here</b>
            <span>or choose them from this computer. Pasting works too.</span>
          </button>
        )}
        <div className="sources" role="group" aria-label="Add photos from">
          {n > 0 && (
            <button className="source" onClick={() => upload.current?.click()} disabled={n >= MAX}>
              <span className="src-ic"><Icon.upload /></span><b>Add photos</b><small>Choose, drop or paste</small>
            </button>
          )}
          <button className={`source ${collect.on ? "live" : ""}`} onClick={() => (gp === "connected" && !collect.on ? fromGoogle() : fromWeb())} disabled={!!gpBusy || (n >= MAX && !collect.on)} aria-pressed={collect.on}>
            <span className="src-ic g"><Icon.photos /></span><b>Google Photos</b><small>{gpBusy ?? (collect.on ? "Collecting. Tap to finish" : "Opens it. Tap your photos")}</small>
          </button>
        </div>
        {collect.on ? (
          <div className="collect-live" role="status">
            <i className="live-dot" aria-hidden />
            <div><b>Tap the photos of you in the other tab</b><p>Each one lands here as you tap it. Press Done there, or here, when you have enough.</p></div>
            <button className="btn filled small" onClick={() => stopCollect()}>Done</button>
          </div>
        ) : n === 0 ? (
          <ul className="dz-tips">
            <li><Icon.person /><span><b>One or two of just you</b>So Zero Q knows your face.</span></li>
            <li><Icon.group /><span><b>Group photos are welcome</b>It crops them to you.</span></li>
            <li><Icon.expand /><span><b>Full length is best</b>Head to toe shows the whole outfit.</span></li>
            <li><Icon.check /><span><b>Matched on this device</b>Finding your face sends nothing anywhere.</span></li>
          </ul>
        ) : null}

        {n > 0 && (portrait && found.portrait ? (
          <div className="you" role="status">
            <img src={portrait.url} alt="" />
            <div><b>That's you</b><p>{cropped ? `Found you in ${cropped === 1 ? "one group photo" : `${cropped} group photos`} and cropped ${cropped === 1 ? "it" : "them"} to you.` : "Group photos you add are cropped to you."}</p></div>
          </div>
        ) : noRef ? (
          <div className="you ask" role="status">
            <span className="you-q" aria-hidden><Icon.face /></span>
            <div><b>Which one is you?</b><p>Add one photo of just you, or tap yourself in a group photo. Zero Q finds you in the rest.</p></div>
          </div>
        ) : blind ? (
          <p className="hint" role="status">Faces could not be read in this browser, so group photos stay whole. Crop them to you before adding.</p>
        ) : null)}

        {n > 0 && (
          <div className="shots">
            {photos.map((x, i) => {
              const v = verdicts.get(x.url);
              const state = x.faces === undefined ? "reading" : v && !v.settled ? "choose" : "ok";
              const many = (x.faces?.length ?? 0) > 1;
              return (
                <div className={`shot ${state} ${x.fresh != null ? "fresh" : ""} ${x.found ? "found" : ""}`} key={x.url} style={x.fresh != null ? ({ "--i": x.fresh } as any) : undefined}>
                  {x.found && x.thumb && x.me != null && x.faces && x.w && x.h
                    ? <FoundYou shot={x} label={`Outfit ${i + 1}`} onEnd={() => patch(x.url, (y) => ({ ...y, found: false }))} />
                    : <img className={x.thumb ? "cut" : undefined} src={x.thumb ?? x.url} alt={`Outfit ${i + 1}`} />}
                  {x.source === "google" && <span className="shot-src" aria-label="From Google Photos"><Icon.photos /></span>}
                  {state === "ok" && many && !x.found && (
                    <button className="shot-who" aria-label={`Photo ${i + 1}: ${x.me != null ? "cropped to you. Change who is you" : "choose who is you"}`} onClick={() => setWho(x.url)}>
                      {x.me != null ? <Icon.tick /> : <Icon.group />}{x.me != null && <span>You</span>}
                    </button>
                  )}
                  {state === "reading" && <span className="shot-over"><i className="scan" aria-hidden />Looking</span>}
                  {state === "choose" && (
                    <button className="shot-over choose" onClick={() => setWho(x.url)}>
                      <Icon.face />{v!.why === "unsure" ? "Is this you?" : v!.why === "not-found" ? "Can't see you. Tap to show" : "Which one is you?"}
                    </button>
                  )}
                  <button className="slot-x" aria-label={`Remove outfit ${i + 1}`} onClick={() => setPhotos((p) => p.filter((y) => y.url !== x.url))}>✕</button>
                </div>
              );
            })}
            {n < MAX && <button className="shot add" onClick={() => upload.current?.click()} aria-label="Add outfit photos"><Icon.plus /></button>}
          </div>
        )}
        {n > 0 && (
          <div className="slot-count">
            <span className="hint" role="status">{status}</span>
            <b>{n}<span className="faint"> / {MAX}</span></b>
          </div>
        )}
        {n > 0 && !collect.on && <p className="hint">On Instagram or any other site, right-click a photo and choose "Use as my outfit photo in Zero Q".</p>}
      </div>

      {dragging && <div className="drop-veil" aria-hidden><div><Icon.upload /><b>Drop to add</b><span>Solo and group photos together</span></div></div>}
      <WhoSheet shot={asking} guess={asking ? verdicts.get(asking.url)?.me ?? null : null} onClose={() => setWho(null)} onPick={(i) => {
        const x = asking!;
        setWho(null);
        if (i == null) return setPhotos((p) => p.filter((y) => y.url !== x.url));
        patch(x.url, (y) => ({ ...y, picked: i }));
      }} />
    </Shell>
  );
}

/** The moment a group photo is recognised: a ring lands on your face, the photo closes in on you, and the crop takes over. */
function FoundYou({ shot, label, onEnd }: { shot: Shot; label: string; onEnd: () => void }) {
  const aspect = shot.w! / shot.h!;
  const f = shot.faces![shot.me!];
  const z = tileZoom(bodyBox(f, shot.faces!, aspect), aspect, TILE, HEAD);
  // the ring is drawn in the photo's own frame: its size is the face's longer side, as a share of the photo's width
  const ring = Math.max(f.box[2] - f.box[0], (f.box[3] - f.box[1]) / aspect) * 1.5 * 100;
  useEffect(() => {
    const t = setTimeout(onEnd, 2200); // in case the animation never reports back
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <div className="shot-zoom" aria-hidden
        style={{ left: `${z.frame.left}%`, top: `${z.frame.top}%`, width: `${z.frame.width}%`, height: `${z.frame.height}%`, "--x": `${z.move.x}%`, "--y": `${z.move.y}%`, "--s": z.move.scale } as any}>
        <img src={shot.url} alt="" />
        <i className="shot-ring" style={{ left: `${((f.box[0] + f.box[2]) / 2) * 100}%`, top: `${((f.box[1] + f.box[3]) / 2) * 100}%`, width: `${ring}%` }} />
      </div>
      <img className="shot-crop cut" src={shot.thumb} alt={label} onAnimationEnd={onEnd} />
    </>
  );
}

/** A group photo with a ring on each face: tap the one that is you. */
function WhoSheet({ shot, guess, onClose, onPick }: { shot: Shot | null; guess: number | null; onClose: () => void; onPick: (i: number | null) => void }) {
  const aspect = shot?.w && shot?.h ? shot.w / shot.h : 1;
  return (
    <Sheet open={!!shot} onClose={onClose} title="Which one is you?">
      {shot && (
        <div className="who">
          <div className="who-photo">
            <img src={shot.url} alt="Group photo" />
            {shot.faces?.map((f, i) => {
              const mine = shot.me === i || (shot.me == null && guess === i);
              return (
                <button key={i} className={`who-face ${mine ? "guess" : ""}`} aria-label={`Person ${i + 1}${shot.me === i ? ", chosen as you" : mine ? ", probably you" : ""}`}
                  style={{ left: `${((f.box[0] + f.box[2]) / 2) * 100}%`, top: `${((f.box[1] + f.box[3]) / 2) * 100}%`, width: `${Math.max(f.box[2] - f.box[0], (f.box[3] - f.box[1]) / aspect) * 150}%` }}
                  onClick={() => onPick(i)}>
                  {mine && <span>{shot.me === i ? "You" : "You?"}</span>}
                </button>
              );
            })}
          </div>
          <p className="hint center">Tap your face. Zero Q crops to you and reads only your outfit.</p>
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
              <button key={l.name} className="su-look" aria-pressed={on} onClick={() => flip("looks", l.name)}>
                <span className="su-shades" aria-hidden>{l.shades.map((c) => <i key={c} style={{ background: c }} />)}</span>
                {on && <span className="su-tick"><Icon.tick /></span>}
                <b>{l.name}</b>
                <span className="su-says">{l.says}</span>
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
