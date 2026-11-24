import { describe, expect, it } from "vitest";
import { bodyBox, clearFaces, faceDistance, findMe, photoKind, portraitBox, tileZoom, type Box, type Face } from "../src/faces.ts";

/** A made-up person: a fixed point in face space. Each photo of them lands a little way off it. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
function person(seed: number): number[] {
  const r = rng(seed);
  const v = Array.from({ length: 128 }, () => r() - 0.5);
  const n = Math.hypot(...v);
  return v.map((x) => (x / n) * 0.55); // strangers end up about 0.78 apart
}
function shot(of: number[], seed: number, spread = 0.3): number[] {
  const r = rng(seed * 7919 + 13);
  const v = Array.from({ length: 128 }, () => r() - 0.5);
  const n = Math.hypot(...v);
  return of.map((x, i) => x + (v[i] / n) * spread);
}
const face = (d: number[], box: Box = [0.4, 0.1, 0.6, 0.3], score = 0.98): Face => ({ box, score, d });
const ME = person(1), ASHA = person(2), RAVI = person(3), ZOYA = person(4);
const row = (i: number, n: number, h = 0.12): Box => [(i + 0.3) / n, 0.2, (i + 0.7) / n, 0.2 + h];

describe("telling faces apart", () => {
  it("puts photos of one person closer than photos of two", () => {
    expect(faceDistance(shot(ME, 1), shot(ME, 2))).toBeLessThan(0.5);
    expect(faceDistance(shot(ME, 1), shot(ASHA, 2))).toBeGreaterThan(0.65);
  });

  it("ignores unsure detections and passers-by when deciding solo or group", () => {
    expect(photoKind([])).toBe("none");
    expect(photoKind([face(ME), face(ASHA, [0.1, 0.7, 0.13, 0.74])])).toBe("solo"); // tiny face far behind
    expect(photoKind([face(ME), face(ASHA, [0.1, 0.1, 0.3, 0.3], 0.4)])).toBe("solo"); // probably not a face
    expect(photoKind([face(ME, row(0, 2)), face(ASHA, row(1, 2))])).toBe("group");
    expect(clearFaces([face(ASHA, row(0, 2, 0.1)), face(ME, row(1, 2, 0.2))])[0].d).toEqual(ME); // largest first
  });
});

describe("finding you", () => {
  const solo1 = { id: "solo1", faces: [face(shot(ME, 1))] };
  const solo2 = { id: "solo2", faces: [face(shot(ME, 2))] };
  const group = { id: "group", faces: [face(shot(ASHA, 3), row(0, 3, 0.14)), face(shot(ME, 4), row(1, 3, 0.13)), face(shot(RAVI, 5), row(2, 3, 0.12))] };

  it("learns you from one solo photo and finds you in a group", () => {
    const r = findMe([solo1, group]);
    const v = r.verdicts.find((x) => x.id === "group")!;
    expect(r.known).toBe(1);
    expect(v).toMatchObject({ kind: "group", me: 1, settled: true, why: "match" });
    expect(r.verdicts.find((x) => x.id === "solo1")).toMatchObject({ kind: "solo", me: 0, settled: true });
  });

  it("does not depend on the order photos were added", () => {
    expect(findMe([group, solo2, solo1]).verdicts[0]).toMatchObject({ me: 1, settled: true });
  });

  it("waits when it has only group photos, then finds you everywhere after one tap", () => {
    const g2 = { id: "g2", faces: [face(shot(ME, 8), row(0, 2)), face(shot(ZOYA, 9), row(1, 2))] };
    const before = findMe([group, g2]);
    expect(before.verdicts.map((v) => v.why)).toEqual(["no-reference", "no-reference"]);
    expect(before.verdicts.every((v) => !v.settled)).toBe(true);
    const mine = clearFaces(group.faces).findIndex((f) => faceDistance(f.d, ME) < 0.4);
    const after = findMe([{ ...group, picked: mine }, g2]);
    expect(after.verdicts[0]).toMatchObject({ me: mine, settled: true, why: "picked" });
    expect(after.verdicts[1]).toMatchObject({ me: 0, settled: true, why: "match" });
    expect(after.portrait).toEqual({ id: "group", index: mine });
  });

  it("asks when nobody in the photo looks like you", () => {
    const strangers = { id: "s", faces: [face(shot(ASHA, 3), row(0, 2)), face(shot(RAVI, 5), row(1, 2))] };
    expect(findMe([solo1, solo2, strangers]).verdicts[2]).toMatchObject({ me: null, settled: false, why: "not-found" });
  });

  it("offers a guess but asks when two people are about as close", () => {
    const twin = shot(ME, 4, 0.34);
    const near = { id: "t", faces: [face(shot(ME, 6, 0.36), row(0, 2)), face(twin, row(1, 2))] };
    const v = findMe([solo1, near]).verdicts[1];
    expect(v.settled).toBe(false);
    expect(v.why).toBe("unsure");
    expect(v.me).not.toBeNull();
  });

  it("respects \"I'm not in this one\" and a manual pick over its own match", () => {
    expect(findMe([solo1, { ...group, picked: null }]).verdicts[1]).toMatchObject({ me: null, settled: true, why: "left-out" });
    expect(findMe([solo1, { ...group, picked: 0 }]).verdicts[1]).toMatchObject({ me: 0, settled: true, why: "picked" });
  });

  it("does not learn from a solo photo of someone else when the rest agree", () => {
    const friend = { id: "friend", faces: [face(shot(ASHA, 11))] };
    const solo3 = { id: "solo3", faces: [face(shot(ME, 12))] };
    const g = { id: "g", faces: [face(shot(ASHA, 3), row(0, 2)), face(shot(ME, 4), row(1, 2))] };
    const r = findMe([solo1, solo2, solo3, friend, g]);
    expect(r.known).toBe(3);
    expect(r.verdicts.find((v) => v.id === "g")).toMatchObject({ settled: true, why: "match" });
    const me = clearFaces(g.faces)[r.verdicts.find((v) => v.id === "g")!.me!];
    expect(faceDistance(me.d, ME)).toBeLessThan(0.4);
  });

  it("keeps a photo with no face as it is", () => {
    expect(findMe([{ id: "back", faces: [] }]).verdicts[0]).toMatchObject({ kind: "none", settled: true, why: "none" });
  });

  it("can find you at the back of a group, behind bigger faces", () => {
    const g = { id: "g", faces: [face(shot(ASHA, 3), [0.1, 0.2, 0.4, 0.6]), face(shot(ME, 4), [0.7, 0.2, 0.8, 0.33])] };
    expect(photoKind(g.faces)).toBe("solo"); // by size it looks like a photo of Asha
    const picked = findMe([solo1, { ...g, picked: 1 }]).verdicts[1];
    expect(picked).toMatchObject({ me: 1, why: "picked" });
  });
});

describe("cropping to you", () => {
  it("takes head to toe, keeps your shoulders and stops short of the neighbours' faces", () => {
    const a = face(ASHA, [0.2, 0.2, 0.28, 0.32]), me = face(ME, [0.46, 0.2, 0.54, 0.32]), b = face(RAVI, [0.72, 0.2, 0.8, 0.32]);
    const box = bodyBox(me, [a, me, b], 1.5);
    expect(box[0]).toBeGreaterThan(0.28); // right of Asha's face
    expect(box[0]).toBeLessThan(0.4); // with room for a shoulder
    expect(box[2]).toBeLessThan(0.72); // left of Ravi's face
    expect(box[2]).toBeGreaterThan(0.6);
    expect(box[1]).toBeLessThan(0.2);
    expect(box[3]).toBe(1);
  });

  it("is not squeezed by someone standing in the row behind", () => {
    const me = face(ME, [0.45, 0.5, 0.55, 0.62]), behind = face(ASHA, [0.47, 0.2, 0.53, 0.28]);
    const box = bodyBox(me, [me, behind], 1.5);
    expect(box[2] - box[0]).toBeGreaterThan(0.25);
  });

  it("stays inside the photo", () => {
    const box = bodyBox(face(ME, [0, 0, 0.2, 0.3]), [], 0.75);
    expect(box.every((n) => n >= 0 && n <= 1)).toBe(true);
    const p = portraitBox(face(ME, [0.9, 0.9, 1, 1]), 1);
    expect(p.every((n) => n >= 0 && n <= 1)).toBe(true);
  });

  it("zooms a thumbnail onto one person without showing an empty edge", () => {
    // a wide photo in a tall tile: the photo is twice as wide as the tile to begin with
    const z = tileZoom([0.5, 0, 0.75, 1], 1.5, 0.75);
    expect(z.frame.left).toBeCloseTo(-50);
    expect(z.frame.width).toBeCloseTo(200);
    expect(z.frame.height).toBeCloseTo(100);
    expect(z.move.scale).toBeCloseTo(2);
    expect(z.move.x).toBeCloseTo(-75);
    expect(z.move.y).toBeCloseTo(-50);
    // someone at the far left: the zoom stops at the photo's edge
    const edge = tileZoom([0, 0.1, 0.1, 0.6], 1.5, 0.75);
    const leftEdge = edge.frame.left + (edge.move.x / 100) * edge.frame.width;
    expect(leftEdge).toBeCloseTo(0);
    // a tall, narrow person: keep the head end in view when asked to
    const tall = tileZoom([0.4, 0, 0.6, 1], 1, 0.75, 0);
    expect(tall.move.scale).toBeCloseTo(3.75);
    expect(tall.frame.top + (tall.move.y / 100) * tall.frame.height).toBeCloseTo(0); // the photo's top edge sits at the tile's top
    const mid = tileZoom([0.4, 0, 0.6, 1], 1, 0.75);
    expect(mid.move.y).toBeLessThan(tall.move.y);
    // a box that already fills the tile does not zoom
    const still = tileZoom([0, 0, 1, 1], 0.75, 0.75).move;
    expect(still.x).toBeCloseTo(0);
    expect(still.y).toBeCloseTo(0);
    expect(still.scale).toBe(1);
  });
});
