// Milestone 4 rendering tests with a real FFmpeg: colour LUT, chroma key, keyframes, masks, effects, audio fx.
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { produce } from "immer";
import * as ops from "../../src/engine/timelineOps";
import { buildExport, needsAssets, type ClipAssets } from "../../src/engine/exportGraph";
import { defaultExportSettings } from "../../src/engine/presets";
import { buildLut, defaultColor, toCube } from "../../src/engine/color";
import { createProject, makeMediaClip } from "../../src/engine/defaults";
import type { MediaAsset, MediaClip, Project } from "../../src/types/project";

const FF = process.env.FFMPEG || "ffmpeg";
const FP = process.env.FFPROBE || "ffprobe";
const dir = mkdtempSync(join(tmpdir(), "studiox-m4-"));
const ff = (args: string[]) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
const S = { ...defaultExportSettings(640, 360, 25), width: 640, height: 360, fps: 25, speedPreset: "fast" as const };

function asset(id: string, path: string, kind: MediaAsset["kind"], w: number, h: number, dur: number, audio = false): MediaAsset {
  return { id, path, name: id, kind, duration: dur, width: w, height: h, fps: 25, hasVideo: kind !== "audio", hasAudio: audio, size: 1, mtime: 1, addedAt: 0 };
}
/** RGB of the pixel at (x,y) of the frame at time t */
function px(file: string, t: number, x: number, y: number): number[] {
  const buf = execFileSync(FF, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
  return [buf[0], buf[1], buf[2]];
}
function render(p: Project, name: string, assets: Record<string, ClipAssets> = {}) {
  const out = join(dir, name);
  const plan = buildExport(p, S, {}, assets);
  const script = join(dir, name + ".txt");
  writeFileSync(script, plan.filterGraph);
  try {
    execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", "-filter_complex_threads", "2", ...plan.inputArgs, "-filter_complex_script", script, ...plan.outputArgs, out], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    throw new Error(`FFmpeg failed:\n${e.stderr?.toString()}\n${plan.filterGraph}`);
  }
  return out;
}
let RED: MediaAsset, GREEN: MediaAsset, BARS: MediaAsset, SQ: MediaAsset, TONE: MediaAsset;
beforeAll(() => {
  ff(["-f", "lavfi", "-i", "color=c=red:s=640x360:r=25:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "red.mp4")]);
  ff(["-f", "lavfi", "-i", "color=c=0x00ff00:s=640x360:r=25:d=4", "-vf", "drawbox=x=270:y=130:w=100:h=100:color=white:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "green.mp4")]);
  ff(["-f", "lavfi", "-i", "smptebars=s=640x360:r=25:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(dir, "bars.mp4")]);
  ff(["-f", "lavfi", "-i", "color=c=blue:s=100x100", "-frames:v", "1", join(dir, "sq.png")]);
  RED = asset("red", join(dir, "red.mp4"), "video", 640, 360, 4);
  GREEN = asset("green", join(dir, "green.mp4"), "video", 640, 360, 4);
  BARS = asset("bars", join(dir, "bars.mp4"), "video", 640, 360, 4, true);
  SQ = asset("sq", join(dir, "sq.png"), "image", 100, 100, 0);
  TONE = BARS;
});

function proj(clips: (p: Project, v1: string, v2: string, a1: string) => MediaClip[]): Project {
  const p = createProject("M4", { width: 640, height: 360, fps: 25 });
  p.media.push(RED, GREEN, BARS, SQ);
  const v2 = p.tracks[1].id, v1 = p.tracks[2].id, a1 = p.tracks[3].id;
  const cs = clips(p, v1, v2, a1);
  return produce(p, (d) => cs.forEach((c) => ops.addClip(d, c)));
}

describe("M4 rendering", () => {
  it("colour grade (black & white via shared LUT) is applied in export", () => {
    const p = proj((_p, v1) => {
      const c = makeMediaClip(BARS, v1, 0, 25);
      c.duration = 2;
      c.color = { ...defaultColor(), saturation: -1 };
      return [c];
    });
    const id = Object.keys(p.clips)[0];
    expect(needsAssets(p.clips[id] as MediaClip).lut).toBe(true);
    const cube = join(dir, "grade.cube");
    writeFileSync(cube, toCube(buildLut((p.clips[id] as MediaClip).color!)));
    const out = render(p, "color.mp4", { [id]: { lut: cube } });
    const [r, g, b] = px(out, 1, 230, 100); // a saturated bar
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
  });

  it("chroma key removes the green background", () => {
    const p = proj((_p, v1, v2) => {
      const bg = makeMediaClip(RED, v1, 0, 25);
      bg.duration = 2;
      const fg = makeMediaClip(GREEN, v2, 0, 25);
      fg.duration = 2;
      fg.chromaKey = { enabled: true, color: "#00ff00", similarity: 0.15, blend: 0.05 };
      return [bg, fg];
    });
    const out = render(p, "chroma.mp4");
    const [r, g] = px(out, 1, 40, 40); // keyed area shows red underneath
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(80);
    const centre = px(out, 1, 320, 180); // white box stays
    expect(Math.min(...centre)).toBeGreaterThan(200);
  });

  it("position, scale and opacity keyframes animate in export", () => {
    const p = proj((_p, v1, v2) => {
      const bg = makeMediaClip(RED, v1, 0, 25);
      bg.duration = 2;
      const sq = makeMediaClip(SQ, v2, 0, 25);
      sq.duration = 2;
      sq.transform.scale = 0.2; // 360*0.2 = 72 px square
      sq.keyframes = {
        x: [{ t: 0, v: -200, ease: "linear" }, { t: 1.6, v: 200, ease: "linear" }],
        scale: [{ t: 0, v: 0.2, ease: "linear" }, { t: 1.6, v: 0.4, ease: "linear" }],
        rotation: [{ t: 0, v: 0, ease: "linear" }, { t: 1.6, v: 45, ease: "linear" }],
      };
      return [bg, sq];
    });
    const out = render(p, "kf.mp4");
    const at0left = px(out, 0.0, 120, 180);
    const at0right = px(out, 0.0, 520, 180);
    expect(at0left[2]).toBeGreaterThan(180); // blue square on the left at t=0
    expect(at0right[0]).toBeGreaterThan(180); // red background on the right
    const end = px(out, 1.8, 520, 180);
    expect(end[2]).toBeGreaterThan(180); // moved to the right
    const endLeft = px(out, 1.8, 120, 180);
    expect(endLeft[0]).toBeGreaterThan(180);
    // scaled to ~144 px and rotated 45°: a point 85 px above the centre is inside the diamond
    const top = px(out, 1.8, 520, 180 - 85);
    expect(top[2]).toBeGreaterThan(150);
  });

  it("opacity keyframes fade a layer in", () => {
    const p = proj((_p, v1, v2) => {
      const bg = makeMediaClip(RED, v1, 0, 25);
      bg.duration = 2;
      const fg = makeMediaClip(BARS, v2, 0, 25);
      fg.duration = 2;
      fg.keyframes = { opacity: [{ t: 0, v: 0, ease: "linear" }, { t: 1, v: 1, ease: "linear" }] };
      return [bg, fg];
    });
    const out = render(p, "opkf.mp4");
    expect(px(out, 0.0, 600, 50)[0]).toBeGreaterThan(180); // only red visible
    const late = px(out, 1.5, 600, 50); // last bar (blue) fully visible
    expect(late[2]).toBeGreaterThan(150);
    expect(late[0]).toBeLessThan(80);
  });

  it("mask, vignette and effects render", () => {
    const p = proj((_p, v1, v2) => {
      const bg = makeMediaClip(RED, v1, 0, 25);
      bg.duration = 2;
      const fg = makeMediaClip(BARS, v2, 0, 25);
      fg.duration = 2;
      fg.mask = { shape: "ellipse", x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0, invert: false };
      fg.effects = [
        { id: "a", type: "blur", enabled: true, amount: 0.05 },
        { id: "b", type: "grain", enabled: true, amount: 0.3 },
        { id: "c", type: "sharpen", enabled: true, amount: 0.5 },
        { id: "d", type: "letterbox", enabled: true, amount: 0.2 },
        { id: "e", type: "vignette", enabled: true, amount: 0.8 },
      ];
      return [bg, fg];
    });
    const id = Object.values(p.clips).find((c) => (c as MediaClip).mask)!.id;
    // mask: white ellipse in the centre (alpha) ; vignette: transparent centre, dark edges
    ff(["-f", "lavfi", "-i", "color=c=white@0:s=640x360,format=rgba,geq=r=255:g=255:b=255:a='255*lt(hypot((X-320)/160,(Y-180)/90),1)'", "-frames:v", "1", join(dir, "mask.png")]);
    ff(["-f", "lavfi", "-i", "color=c=black@0:s=640x360,format=rgba,geq=r=0:g=0:b=0:a='255*clip(hypot((X-320)/320,(Y-180)/180)-0.5,0,1)'", "-frames:v", "1", join(dir, "vig.png")]);
    const out = render(p, "fx.mp4", { [id]: { mask: join(dir, "mask.png"), vignette: join(dir, "vig.png") } });
    expect(px(out, 1, 20, 20)[0]).toBeGreaterThan(180); // outside the mask → red background
    const c = px(out, 1, 320, 180); // inside the mask → bars (not pure red)
    expect(c[1] + c[2]).toBeGreaterThan(150);
  });

  it("audio: volume keyframes, EQ, compressor, noise reduction, master limiter", () => {
    let p = proj((_p, v1) => {
      const c = makeMediaClip(TONE, v1, 0, 25);
      c.duration = 3;
      c.keyframes = { volume: [{ t: 0, v: 0, ease: "linear" }, { t: 2, v: 1, ease: "linear" }] };
      c.audioFx = { eqLow: 3, eqMid: -2, eqHigh: 2, compressor: 0.5, noiseReduction: 0.3 };
      return [c];
    });
    p = produce(p, (d) => void (d.master = { volume: 0.9, limiter: true }));
    const out = render(p, "audio.mp4");
    const meanAt = (t: number) => {
      const err = spawnSync(FF, ["-hide_banner", "-ss", String(t), "-t", "0.3", "-i", out, "-af", "volumedetect", "-vn", "-f", "null", "-"]).stderr.toString();
      return parseFloat(/mean_volume: (-?[\d.]+) dB/.exec(err)?.[1] ?? "-99");
    };
    expect(meanAt(2.4)).toBeGreaterThan(meanAt(0.1) + 10); // fades in via keyframes
    const pr = JSON.parse(execFileSync(FP, ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
    expect(pr.streams.some((s: any) => s.codec_type === "audio")).toBe(true);
  });
});
