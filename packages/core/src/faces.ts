/**
 * Finding you in your own photos.
 *
 * The face reader (in the extension) turns each face into a list of numbers.
 * Two faces of the same person give lists that sit close together. This file
 * holds the reasoning on top of that: learn who "you" are from photos with one
 * face in them, find that face in group photos, work out where the rest of you
 * is so the photo can be cropped, and know when to ask instead of guessing.
 *
 * Pure functions, no browser needed.
 */

/** left, top, right, bottom as fractions of the photo */
export type Box = [number, number, number, number];

export interface Face {
  box: Box;
  /** how sure the reader is that this is a face, 0..1 */
  score: number;
  /** the face's measurements */
  d: ArrayLike<number>;
}

/**
 * How close two readings of the same person usually are. Measured on test
 * photos with this face reader: the same person lands around 0.3 to 0.6 even
 * through strong expressions, strangers from about 0.55 up. The two overlap,
 * so a match also has to beat everyone else in the photo by a clear margin.
 */
export const SURE = 0.55;
/** Further than this, the best face is not offered as a guess. */
export const GUESS = 0.64;
/** The next closest face in the photo must be at least this much further away. */
export const MARGIN = 0.08;
/** A face this small next to the biggest one is someone in the background. */
const BACKGROUND = 0.4;
const MIN_SCORE = 0.5;

export function faceDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - b[i];
    s += x * x;
  }
  return Math.sqrt(s);
}

const height = (f: Face) => f.box[3] - f.box[1];

/** Faces that count: sure enough to be faces, largest first. */
export function clearFaces(faces: Face[]): Face[] {
  return faces.filter((f) => f.score >= MIN_SCORE).sort((a, b) => height(b) - height(a));
}

/** The people the photo is about: leaves out passers-by far behind the main face. */
export function peopleIn(faces: Face[]): Face[] {
  const all = clearFaces(faces);
  if (!all.length) return all;
  const big = height(all[0]);
  return all.filter((f) => height(f) >= big * BACKGROUND);
}

export type PhotoKind = "none" | "solo" | "group";
export function photoKind(faces: Face[]): PhotoKind {
  const n = peopleIn(faces).length;
  return n === 0 ? "none" : n === 1 ? "solo" : "group";
}

export interface PhotoFaces {
  id: string;
  faces: Face[];
  /** what the user tapped: a face (index into clearFaces(faces)), or null for "I'm not in this one" */
  picked?: number | null;
}

export type Why =
  /** no face to go on: the photo is kept whole */
  | "none"
  /** one person: that is you */
  | "solo"
  /** you tapped yourself */
  | "picked"
  /** you said you are not in it */
  | "left-out"
  /** found you, clearly */
  | "match"
  /** probably this one, but worth a tap */
  | "unsure"
  /** nobody here looks like you */
  | "not-found"
  /** a group photo, and nothing yet to know you by */
  | "no-reference";

export interface FaceVerdict {
  id: string;
  kind: PhotoKind;
  /** which face is you (index into clearFaces(faces), largest first), or null */
  me: number | null;
  /** true when Zero Q can go ahead without asking */
  settled: boolean;
  why: Why;
  /** how close the chosen face is to the faces known to be you */
  distance?: number;
}

export interface FindResult {
  verdicts: FaceVerdict[];
  /** how many faces Zero Q knows you by */
  known: number;
  /** the photo and person that best shows your face, for a small "this is you" picture */
  portrait: { id: string; index: number } | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Decides, for every photo, which person is you.
 *
 * You are learned from photos with one person in them, plus any face you
 * tapped yourself. With three or more such photos, one that looks unlike the
 * rest (a friend's photo that slipped in) is not used to learn from.
 */
export function findMe(photos: PhotoFaces[]): FindResult {
  // Every clear face can be you, even a small one at the back. Whether the photo
  // counts as a group goes by the people it is about (see peopleIn).
  const people = new Map(photos.map((p) => [p.id, clearFaces(p.faces)]));
  const kinds = new Map(photos.map((p) => [p.id, photoKind(p.faces)]));
  interface Ref { id: string; index: number; d: ArrayLike<number>; size: number; tapped: boolean }
  let refs: Ref[] = [];
  for (const p of photos) {
    const ppl = people.get(p.id)!;
    if (typeof p.picked === "number" && ppl[p.picked]) refs.push({ id: p.id, index: p.picked, d: ppl[p.picked].d, size: height(ppl[p.picked]), tapped: true });
    else if (p.picked === undefined && kinds.get(p.id) === "solo") refs.push({ id: p.id, index: 0, d: ppl[0].d, size: height(ppl[0]), tapped: false });
  }
  if (refs.length >= 3) {
    const odd = (r: Ref) => !r.tapped && median(refs.filter((o) => o !== r).map((o) => faceDistance(r.d, o.d))) > GUESS + 0.04;
    const kept = refs.filter((r) => !odd(r));
    if (kept.length) refs = kept;
  }

  const verdicts: FaceVerdict[] = photos.map((p) => {
    const ppl = people.get(p.id)!;
    const kind = kinds.get(p.id)!;
    if (p.picked === null) return { id: p.id, kind, me: null, settled: true, why: "left-out" };
    if (typeof p.picked === "number" && ppl[p.picked]) return { id: p.id, kind, me: p.picked, settled: true, why: "picked" };
    if (kind === "none") return { id: p.id, kind, me: null, settled: true, why: "none" };
    if (kind === "solo") return { id: p.id, kind, me: 0, settled: true, why: "solo" };
    if (!refs.length) return { id: p.id, kind, me: null, settled: false, why: "no-reference" };
    const near = ppl.map((f) => Math.min(...refs.map((r) => faceDistance(f.d, r.d))));
    const order = near.map((_, i) => i).sort((a, b) => near[a] - near[b]);
    const best = order[0], gap = near[order[1]] - near[best];
    if (near[best] < SURE && gap >= MARGIN) return { id: p.id, kind, me: best, settled: true, why: "match", distance: near[best] };
    if (near[best] < GUESS) return { id: p.id, kind, me: best, settled: false, why: "unsure", distance: near[best] };
    return { id: p.id, kind, me: null, settled: false, why: "not-found", distance: near[best] };
  });

  // The clearest look at your face: a tapped or solo face, the largest one.
  const best = [...refs].sort((a, b) => b.size - a.size)[0];
  return { verdicts, known: refs.length, portrait: best ? { id: best.id, index: best.index } : null };
}

/**
 * Where the whole person is, going by their face. The crop keeps head to toe
 * when the photo has it, and stops short of the faces of the people next to them.
 * `aspect` is the photo's width divided by its height.
 */
export function bodyBox(face: Face, others: Face[], aspect: number): Box {
  // work in units where the photo is `aspect` wide and 1 tall, so a face is as wide as it looks
  const fw = (face.box[2] - face.box[0]) * aspect, fh = face.box[3] - face.box[1];
  const size = Math.max(fw, fh * 0.8);
  const cx = ((face.box[0] + face.box[2]) / 2) * aspect;
  let left = cx - size * 2.2, right = cx + size * 2.2;
  const top = face.box[1] - fh * 0.75;
  const bottom = face.box[1] + fh * 8.6;
  for (const o of others) {
    if (o === face) continue;
    const ocy = (o.box[1] + o.box[3]) / 2;
    // only people beside this one: someone in a row behind or in front does not narrow the crop
    if (ocy < face.box[1] - fh * 1.2 || ocy > face.box[3] + fh * 2.5) continue;
    const ocx = ((o.box[0] + o.box[2]) / 2) * aspect;
    // most of the way to the neighbour: enough for your shoulders, short of their face
    const reach = Math.max(Math.abs(ocx - cx) * 0.7, size * 1.2);
    if (ocx < cx) left = Math.max(left, cx - reach);
    else right = Math.min(right, cx + reach);
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp(left / aspect), clamp(top), clamp(right / aspect), clamp(bottom)];
}

/** A square around the face with some hair and chin, for a small round picture. */
export function portraitBox(face: Face, aspect: number): Box {
  const fw = (face.box[2] - face.box[0]) * aspect, fh = face.box[3] - face.box[1];
  const half = Math.max(fw, fh) * 0.85;
  const cx = ((face.box[0] + face.box[2]) / 2) * aspect, cy = (face.box[1] + face.box[3]) / 2 - fh * 0.08;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp((cx - half) / aspect), clamp(cy - half), clamp((cx + half) / aspect), clamp(cy + half)];
}

export interface TileZoom {
  /** where the whole photo sits so that it fills the tile: left, top, width, height in percent of the tile */
  frame: { left: number; top: number; width: number; height: number };
  /** how to move and scale that frame so the box fills the tile: x and y in percent of the frame */
  move: { x: number; y: number; scale: number };
}

/**
 * A thumbnail shows a photo cropped to fill its tile. This works out how to
 * zoom that thumbnail onto one part of the photo (you, in a group shot) so
 * that part fills the tile instead, without showing an empty edge.
 * Aspects are width divided by height. `focusY` matches the tile's
 * object-position when the part is taller than the tile.
 */
export function tileZoom(box: Box, photoAspect: number, tileAspect: number, focusY = 0.5, maxZoom = 8): TileZoom {
  // tile units: the tile is 1 wide and TH tall
  const TH = 1 / tileAspect;
  const IW = photoAspect > tileAspect ? TH * photoAspect : 1;
  const IH = photoAspect > tileAspect ? TH : 1 / photoAspect;
  const ox = (1 - IW) / 2, oy = (TH - IH) / 2;
  const bw = Math.max(1e-6, (box[2] - box[0]) * IW), bh = Math.max(1e-6, (box[3] - box[1]) * IH);
  const scale = Math.min(maxZoom, Math.max(1, 1 / bw, TH / bh));
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  // The box is as wide or as tall as the tile; the rest of it hangs over. Sideways it is centred.
  // Up and down, focusY says which part to keep: 0 the top, 0.5 the middle, 1 the bottom.
  const nx = clamp(-(bw * scale - 1) / 2 - box[0] * IW * scale, 1 - IW * scale, 0);
  const ny = clamp(-(bh * scale - TH) * focusY - box[1] * IH * scale, TH - IH * scale, 0);
  return {
    frame: { left: ox * 100, top: (oy / TH) * 100, width: IW * 100, height: (IH / TH) * 100 },
    move: { x: ((nx - ox) / IW) * 100, y: ((ny - oy) / IH) * 100, scale },
  };
}
