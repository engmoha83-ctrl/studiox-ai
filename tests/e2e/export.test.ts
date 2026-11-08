// Real FFmpeg integration test: renders a multi-track project and inspects the output.
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { produce } from "immer";
import * as ops from "../../src/engine/timelineOps";
import { buildExport } from "../../src/engine/exportGraph";
import { defaultExportSettings, type ExportSettings } from "../../src/engine/presets";
import { createProject, makeMediaClip, makeTextClip } from "../../src/engine/defaults";
import type { MediaAsset, Project } from "../../src/types/project";

const FF = process.env.FFMPEG || "ffmpeg";
const FP = process.env.FFPROBE || "ffprobe";
const dir = mkdtempSync(join(tmpdir(), "studiox-e2e-"));
const ff = (args: string[]) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });

function probe(path: string): any {
  return JSON.parse(execFileSync(FP, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).toString());
}

function asset(id: string, path: string, kind: MediaAsset["kind"]): MediaAsset {
  const j = probe(path);
  const v = j.streams.find((s: any) => s.codec_type === "video");
  return {
    id, path, name: id, kind, duration: kind === "image" ? 0 : +j.format.duration,
    width: v?.width ?? 0, height: v?.height ?? 0, fps: 30, hasVideo: !!v,
    hasAudio: j.streams.some((s: any) => s.codec_type === "audio"), size: 1, mtime: 1, addedAt: 0,
  };
}

/** mean luma of a frame at time t (0-255) */
function luma(file: string, t: number, crop = ""): number {
  const vf = `${crop ? crop + "," : ""}scale=32:18,format=gray`;
  const buf = execFileSync(FF, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-"]);
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

let project: Project;
let textPng: string;
let textId: string;

beforeAll(() => {
  ff(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=10", "-f", "lavfi", "-i", "sine=f=440:d=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(dir, "a.mp4")]);
  ff(["-f", "lavfi", "-i", "color=c=white:s=640x480:r=25:d=10", "-f", "lavfi", "-i", "sine=f=880:d=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(dir, "b.mov")]);
  ff(["-f", "lavfi", "-i", "color=c=red:s=400x400", "-frames:v", "1", join(dir, "img.png")]);
  ff(["-f", "lavfi", "-i", "sine=f=220:d=8", join(dir, "music.wav")]);
  // stand-in for a rasterised text layer (the real app renders it with the browser text engine)
  textPng = join(dir, "text.png");
  ff(["-f", "lavfi", "-i", "color=c=black@0.0:s=640x360,format=rgba,drawbox=x=220:y=150:w=200:h=60:color=yellow@1:t=fill:replace=1", "-frames:v", "1", textPng]);

  const p = createProject("E2E", { width: 1280, height: 720, fps: 30 });
  p.media.push(asset("a", join(dir, "a.mp4"), "video"), asset("b", join(dir, "b.mov"), "video"), asset("img", join(dir, "img.png"), "image"), asset("m", join(dir, "music.wav"), "audio"));
  const [T1, V2, V1, A1] = [p.tracks[0].id, p.tracks[1].id, p.tracks[2].id, p.tracks[3].id];
  const c1 = makeMediaClip(p.media[0], V1, 0, 30); c1.duration = 4; c1.in = 1;
  const c2 = makeMediaClip(p.media[1], V1, 4, 30); c2.duration = 3; c2.speed = 2; c2.transitionIn = { type: "dissolve", duration: 1 };
  c2.duration = 3; // 6s of source at 2x
  const c3 = makeMediaClip(p.media[2], V2, 1, 30); c3.duration = 2; c3.opacity = 0.8;
  c3.transform = { x: -400, y: -200, scale: 0.3, rotation: 15, flipH: true, flipV: false };
  c3.crop = { left: 0.1, top: 0, right: 0, bottom: 0.1 };
  c3.transitionIn = { type: "slide-left", duration: 0.5 };
  const t = makeTextClip(T1, 0.5, "مرحبا بالعالم 2026"); textId = t.id;
  const m = makeMediaClip(p.media[3], A1, 0.5, 30); m.duration = 5; m.volume = 0.5; m.audioFadeIn = 1; m.audioFadeOut = 1;
  project = produce(p, (d) => { [c1, c2, c3, t, m].forEach((c) => ops.addClip(d, c)); });
});

function render(s: ExportSettings, name: string, ffMajor = 6): string {
  const out = join(dir, name);
  const plan = buildExport(project, s, { [textId]: textPng });
  const script = join(dir, name + ".graph.txt");
  writeFileSync(script, plan.filterGraph);
  const flag = ffMajor >= 7 ? "-/filter_complex" : "-filter_complex_script";
  try {
    execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...plan.inputArgs, flag, script, ...plan.outputArgs, out], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    throw new Error(`FFmpeg failed:\n${e.stderr?.toString()}\nGRAPH:\n${plan.filterGraph}`);
  }
  return out;
}

describe("real FFmpeg export", () => {
  it("renders an H.264/AAC MP4 with correct duration, layers and audio", () => {
    const s = { ...defaultExportSettings(1280, 720, 30), width: 640, height: 360, speedPreset: "fast" as const };
    const out = render(s, "out.mp4");
    expect(existsSync(out)).toBe(true);
    const j = probe(out);
    expect(+j.format.duration).toBeGreaterThan(6.9);
    expect(+j.format.duration).toBeLessThan(7.2);
    const v = j.streams.find((x: any) => x.codec_type === "video");
    const a = j.streams.find((x: any) => x.codec_type === "audio");
    expect(v.codec_name).toBe("h264");
    expect(v.width).toBe(640);
    expect(a.codec_name).toBe("aac");
    // t=0.2: testsrc visible (not black)
    expect(luma(out, 0.2)).toBeGreaterThan(40);
    // t=6: white clip b fully visible
    expect(luma(out, 6.0, "crop=300:300:170:30")).toBeGreaterThan(200);
    // 4:3 source is letterboxed (contain fit): left edge is black
    expect(luma(out, 6.0, "crop=30:300:0:30")).toBeLessThan(30);
    // t=4.5: dissolve midpoint, between the two sources
    const mid = luma(out, 4.5);
    expect(mid).toBeGreaterThan(luma(out, 3.5) - 5);
    expect(mid).toBeLessThan(230);
    // text layer (yellow box at centre) visible at t=2
    expect(luma(out, 2, "crop=100:30:270:165")).toBeGreaterThan(150);
  });

  it("renders WebM VP9/Opus", () => {
    const s: ExportSettings = { ...defaultExportSettings(1280, 720, 30), container: "webm", videoCodec: "libvpx-vp9", audioCodec: "libopus", width: 426, height: 240, speedPreset: "fast", fps: 24 };
    const j = probe(render(s, "out.webm"));
    expect(j.streams.map((x: any) => x.codec_name).sort()).toEqual(["opus", "vp9"]);
  });

  it("renders MOV ProRes, 9:16 letterboxed output and CBR", () => {
    const s: ExportSettings = { ...defaultExportSettings(1280, 720, 30), container: "mov", videoCodec: "prores_ks", audioCodec: "pcm_s16le", width: 320, height: 568 };
    const j = probe(render(s, "out.mov"));
    expect(j.streams.find((x: any) => x.codec_type === "video").codec_name).toBe("prores");
    expect(j.streams.find((x: any) => x.codec_type === "video").height).toBe(568);
    const cbr: ExportSettings = { ...defaultExportSettings(1280, 720, 30), rateControl: "cbr", bitrateKbps: 1500, width: 640, height: 360, speedPreset: "fast" };
    const k = probe(render(cbr, "cbr.mp4"));
    expect(+k.format.bit_rate).toBeLessThan(2_500_000);
  });

  it("renders H.265 and AV1 when available", () => {
    const s: ExportSettings = { ...defaultExportSettings(1280, 720, 30), videoCodec: "libx265", width: 640, height: 360, speedPreset: "fast" };
    expect(probe(render(s, "hevc.mp4")).streams[0].codec_name).toBe("hevc");
    const av1: ExportSettings = { ...s, videoCodec: "libsvtav1" };
    expect(probe(render(av1, "av1.mp4")).streams[0].codec_name).toBe("av1");
  });
});
