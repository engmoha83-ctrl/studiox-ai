import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { buildLut, curveFn, defaultColor, isColorIdentity, parseCube, sampleLut, toCube } from "../src/engine/color";
import { evalKf, kfExpr, setKeyframe } from "../src/engine/keyframes";
import * as ops from "../src/engine/timelineOps";
import type { MediaClip } from "../src/types/project";
import { makeMediaClip, setup } from "./helpers";

describe("colour engine", () => {
  it("identity grade produces an identity LUT", () => {
    const c = defaultColor();
    expect(isColorIdentity(c)).toBe(true);
    const l = buildLut(c, null, 9);
    const s = sampleLut(l, 0.3, 0.6, 0.9);
    expect(s[0]).toBeCloseTo(0.3, 3);
    expect(s[1]).toBeCloseTo(0.6, 3);
    expect(s[2]).toBeCloseTo(0.9, 3);
  });
  it("saturation -1 gives grey; warm temperature raises red", () => {
    const bw = buildLut({ ...defaultColor(), saturation: -1 }, null, 9);
    const [r, g, b] = sampleLut(bw, 0.9, 0.2, 0.1);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.01);
    const warm = buildLut({ ...defaultColor(), temperature: 1 }, null, 9);
    const w = sampleLut(warm, 0.5, 0.5, 0.5);
    expect(w[0]).toBeGreaterThan(w[2]);
  });
  it(".cube round-trip and imported LUT intensity", () => {
    const l = buildLut({ ...defaultColor(), contrast: 0.5 }, null, 5);
    const back = parseCube(toCube(l));
    expect(back.size).toBe(5);
    expect(back.data[30]).toBeCloseTo(l.data[30], 5);
    const invert = { size: 2, data: new Float32Array([1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0]) };
    const half = buildLut({ ...defaultColor(), lutPath: "x.cube", lutIntensity: 0.5 }, invert, 5);
    expect(sampleLut(half, 0, 0, 0)[0]).toBeCloseTo(0.5, 2);
    expect(() => parseCube("LUT_1D_SIZE 4")).toThrow();
  });
  it("curves are monotone and pass through points", () => {
    const f = curveFn([{ x: 0.25, y: 0.1 }, { x: 0.75, y: 0.9 }]);
    expect(f(0.25)).toBeCloseTo(0.1, 5);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      expect(f(x)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f(x);
    }
  });
});

describe("keyframes", () => {
  const kfs = setKeyframe(setKeyframe(undefined, 0, 0, "linear"), 2, 100, "linear");
  it("interpolates and clamps", () => {
    expect(evalKf(kfs, -1, 5)).toBe(0);
    expect(evalKf(kfs, 1, 5)).toBeCloseTo(50);
    expect(evalKf(kfs, 3, 5)).toBe(100);
    expect(evalKf(undefined, 1, 5)).toBe(5);
    const held = [{ t: 0, v: 0, ease: "hold" as const }, { t: 2, v: 100, ease: "linear" as const }];
    expect(evalKf(held, 1.9, 0)).toBe(0);
  });
  it("generates an FFmpeg expression", () => {
    const e = kfExpr(kfs, 0, "T");
    expect(e).toContain("if(lt(T,0),0,");
    expect(e).toContain("if(lt(T,2),");
  });
  it("keyframes stay attached to the source after split / trim", () => {
    const { p, v1 } = setup();
    const c = makeMediaClip(p.media[0], v1, 0, 30);
    c.keyframes = { x: [{ t: 4, v: 10, ease: "linear" }] };
    let q = produce(p, (d) => ops.addClip(d, c));
    let right: string | null = null;
    q = produce(q, (d) => void (right = ops.splitClip(d, c.id, 3)));
    expect((q.clips[right!] as MediaClip).keyframes!.x![0].t).toBeCloseTo(1);
    q = produce(q, (d) => ops.trimClip(d, c.id, "start", 1));
    expect((q.clips[c.id] as MediaClip).keyframes!.x![0].t).toBeCloseTo(3);
  });
});
