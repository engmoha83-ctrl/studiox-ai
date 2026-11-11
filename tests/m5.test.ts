import { describe, expect, it } from "vitest";
import { normalize, parseCommand, validateOps } from "../src/engine/assistantParse";
import { evalKf } from "../src/engine/keyframes";
import { canReframe, reframeClip, reframeSize, smoothFocus, type FocusSample } from "../src/engine/reframe";
import { mediaRect } from "../src/engine/segments";
import { makeMediaClip, media, setup } from "./helpers";

const ops = (s: string) => parseCommand(s).map((o) => o.op);

describe("assistant – built-in parser", () => {
  it("normalises Arabic spelling variants and digits", () => {
    expect(normalize("أَحْذِف الصمتَ ٢٫٥")).toBe("احذف الصمت 2.5");
    expect(normalize("ترجمة")).toBe("ترجمه");
  });

  it("understands the Arabic example request", () => {
    const r = parseCommand("احذف الصمت وحوّله لتيك توك");
    expect(r).toEqual([{ op: "removeSilence" }, { op: "reframe", aspect: "9:16" }]);
  });

  it("understands English requests and orders the steps", () => {
    expect(ops("Export it, add subtitles, remove silence and make it a TikTok")).toEqual(["removeSilence", "reframe", "subtitles", "export"]);
    expect(parseCommand("make it square")).toEqual([{ op: "reframe", aspect: "1:1" }]);
    expect(parseCommand("for youtube please")).toEqual([{ op: "reframe", aspect: "16:9" }]);
    expect(parseCommand("instagram post 4:5")).toEqual([{ op: "reframe", aspect: "4:5" }]);
  });

  it("colour looks, transitions and speed", () => {
    expect(parseCommand("خليه أبيض وأسود")).toEqual([{ op: "color", preset: "bw" }]);
    expect(parseCommand("لون سينمائي")).toEqual([{ op: "color", preset: "cinematic" }]);
    expect(parseCommand("add slide transitions")).toEqual([{ op: "transitions", type: "slide-left" }]);
    expect(parseCommand("ضيف انتقالات")).toEqual([{ op: "transitions", type: "dissolve" }]);
    expect(parseCommand("سرعة 2")).toEqual([{ op: "speed", speed: 2 }]);
    expect(parseCommand("make it 1.5x")).toEqual([{ op: "speed", speed: 1.5 }]);
    expect(parseCommand("slow motion")).toEqual([{ op: "speed", speed: 0.5 }]);
  });

  it("does not trigger on words that merely contain a keyword", () => {
    expect(ops("تحليل")).toEqual([]); // contains "ليل" (night)
    expect(ops("مصدر الصوت")).toEqual([]); // contains "صدر" (export)
    expect(ops("hello there")).toEqual([]);
  });

  it("subtitles language and translation", () => {
    expect(parseCommand("ضيف ترجمة عربي")).toEqual([{ op: "subtitles", language: "ar", translate: false }]);
    expect(parseCommand("add english captions")).toEqual([{ op: "subtitles", language: "en", translate: false }]);
    expect(parseCommand("translate the subtitles to English")).toEqual([{ op: "subtitles", language: "auto", translate: true }]);
  });

  it("titles from quotes or a colon", () => {
    expect(parseCommand('ضيف عنوان "رحلتي إلى أسوان"')).toEqual([{ op: "title", text: "رحلتي إلى أسوان" }]);
    expect(parseCommand("title: My Trip")).toEqual([{ op: "title", text: "My Trip" }]);
  });

  it("'professional' expands to silence + transitions + cinematic colour", () => {
    expect(parseCommand("خليه احترافي")).toEqual([{ op: "removeSilence" }, { op: "transitions", type: "dissolve" }, { op: "color", preset: "cinematic" }]);
  });
});

describe("assistant – LLM output validation", () => {
  it("keeps known operations, clamps values and drops junk", () => {
    const v = validateOps({
      operations: [
        { op: "export" },
        { op: "speed", speed: 99 },
        { op: "color", preset: "rm -rf" },
        { op: "reframe", aspect: "9:16" },
        { op: "deleteEverything" },
        { op: "subtitles", language: "xx", translate: "yes" },
        { op: "speed", speed: 2 },
        "nonsense",
      ],
    });
    expect(v).toEqual([{ op: "speed", speed: 16 }, { op: "reframe", aspect: "9:16" }, { op: "subtitles", language: "auto", translate: false }, { op: "export" }]);
    expect(validateOps("not json")).toEqual([]);
    expect(validateOps(null)).toEqual([]);
  });
});

describe("smart reframe", () => {
  it("keeps the short side when changing aspect", () => {
    expect(reframeSize(1920, 1080, { w: 9, h: 16 })).toEqual({ width: 1080, height: 1920 });
    expect(reframeSize(1920, 1080, { w: 1, h: 1 })).toEqual({ width: 1080, height: 1080 });
    expect(reframeSize(1920, 1080, { w: 4, h: 5 })).toEqual({ width: 1080, height: 1350 });
    expect(reframeSize(1080, 1920, { w: 16, h: 9 })).toEqual({ width: 1920, height: 1080 });
  });

  it("dead-zone smoothing ignores jitter but follows real movement", () => {
    const jitter: FocusSample[] = Array.from({ length: 20 }, (_, i) => ({ t: i / 4, x: 0.5 + (i % 2 ? 0.02 : -0.02), y: 0.5, weight: 1 }));
    const s = smoothFocus(jitter);
    expect(new Set(s.map((x) => x.x.toFixed(4))).size).toBe(1);
    const move: FocusSample[] = Array.from({ length: 40 }, (_, i) => ({ t: i / 4, x: i < 20 ? 0.2 : 0.8, y: 0.5, weight: 1 }));
    const m = smoothFocus(move);
    expect(m[0].x).toBeCloseTo(0.2, 1);
    expect(m[39].x).toBeGreaterThan(0.7);
  });

  it("fills a 9:16 frame and pans the subject to the centre (within the frame edges)", () => {
    const { p, v1 } = setup();
    const m = media("v", "video", 10, "/v", 1920, 1080);
    const c = makeMediaClip(m, v1, 0, 30);
    c.duration = 10;
    expect(canReframe(c, m)).toBe(true);
    const W = 1080, H = 1920;
    // subject moves from left third to right third over 10 s
    const samples: FocusSample[] = Array.from({ length: 41 }, (_, i) => ({ t: i / 4, x: 0.3 + (0.4 * i) / 40, y: 0.5, weight: 1 }));
    const r = reframeClip(c, m, W, H, samples);
    // cover: 1920×1080 into 1080×1920 → fit 0.5625, cover 1.7778 → scale 3.16
    expect(r.scale).toBeCloseTo(1920 / 1080 / (1080 / 1920), 3);
    expect(r.ky).toBeUndefined(); // height already fills the frame, no vertical room
    expect(r.kx && r.kx.length).toBeGreaterThan(2);
    const dw = 1920 * (1920 / 1080);
    const maxX = (dw - W) / 2;
    for (const k of r.kx!) expect(Math.abs(k.v)).toBeLessThanOrEqual(maxX + 0.5);
    // the subject sits near the centre of the output at the start and the end
    for (const [local, fx] of [[1, 0.34], [9, 0.66]] as const) {
      const x = evalKf(r.kx, local, r.x);
      const rect = mediaRect(1920, 1080, { ...c, transform: { ...c.transform, scale: r.scale, x } }, W, H);
      const subjectX = rect.cx + (fx - 0.5) * rect.w;
      expect(Math.abs(subjectX - W / 2)).toBeLessThan(W * 0.12);
      // no black bars: the image covers the canvas
      expect(rect.cx - rect.w / 2).toBeLessThanOrEqual(0.5);
      expect(rect.cx + rect.w / 2).toBeGreaterThanOrEqual(W - 0.5);
    }
    p.clips[c.id] = c;
  });

  it("static shot: one centred position, no keyframes", () => {
    const { v1 } = setup();
    const m = media("v", "video", 10, "/v", 1920, 1080);
    const c = makeMediaClip(m, v1, 0, 30);
    const r = reframeClip(c, m, 1080, 1080, Array.from({ length: 20 }, (_, i) => ({ t: i / 4, x: 0.5, y: 0.5, weight: 0 })));
    expect(r.kx).toBeUndefined();
    expect(r.x).toBe(0);
    expect(r.scale).toBeCloseTo(1920 / 1080, 3);
  });

  it("respects speed (source time → clip time) and leaves user-positioned clips alone", () => {
    const { v1 } = setup();
    const m = media("v", "video", 20, "/v", 1920, 1080);
    const c = makeMediaClip(m, v1, 0, 30);
    c.speed = 2;
    c.duration = 5; // 10 s of source
    const samples: FocusSample[] = Array.from({ length: 41 }, (_, i) => ({ t: i / 4, x: i / 4 < 5 ? 0.2 : 0.8, y: 0.5, weight: 1 }));
    const r = reframeClip(c, m, 1080, 1920, samples);
    const last = r.kx![r.kx!.length - 1];
    expect(last.t).toBeLessThanOrEqual(5 + 1e-6);
    expect(last.v).toBeLessThan(0); // subject on the right → image moved left
    c.transform.scale = 0.5;
    expect(canReframe(c, m)).toBe(false);
    expect(canReframe(makeMediaClip(media("a", "audio", 5), v1, 0, 30), media("a", "audio", 5))).toBe(false);
  });
});
