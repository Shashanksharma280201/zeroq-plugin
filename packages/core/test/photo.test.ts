import { describe, expect, it } from "vitest";
import { bestFromSrcset, largerImageUrl } from "../src/index.ts";

describe("the larger file behind a thumbnail", () => {
  it("asks Google for a readable size", () => {
    expect(largerImageUrl("https://lh3.googleusercontent.com/pw/AP1Gcz-abc_DEF=w256-h256-no?authuser=0")).toBe("https://lh3.googleusercontent.com/pw/AP1Gcz-abc_DEF=w1600-h1600?authuser=0");
    expect(largerImageUrl("https://lh3.googleusercontent.com/a/xyz=s220-c")).toBe("https://lh3.googleusercontent.com/a/xyz=w1600-h1600");
    expect(largerImageUrl("https://photos.fife.usercontent.google.com/pw/AP1Gcz-abc")).toBe("https://photos.fife.usercontent.google.com/pw/AP1Gcz-abc=w1600-h1600");
  });
  it("leaves every other address alone", () => {
    for (const u of ["https://cdn.instagram.com/v/t51/1.jpg?x=1", "data:image/png;base64,AAAA", "not a url", "https://example.com/a=w100-h100"]) expect(largerImageUrl(u)).toBe(u);
  });
  it("picks the biggest srcset entry", () => {
    expect(bestFromSrcset("a.jpg 320w, b.jpg 1080w, c.jpg 640w")).toBe("b.jpg");
    expect(bestFromSrcset("a.jpg 1x, b.jpg 2x")).toBe("b.jpg");
    expect(bestFromSrcset("https://x.test/p,q.jpg 640w, https://x.test/r.jpg 1280w")).toBe("https://x.test/r.jpg");
    expect(bestFromSrcset("")).toBeUndefined();
  });
});
