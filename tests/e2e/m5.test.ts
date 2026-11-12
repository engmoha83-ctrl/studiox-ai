// Milestone 5 rendering test with a real FFmpeg: smart reframe 16:9 → 9:16 keeps a moving
// subject in the middle of the exported frame, with many pan keyframes and no black bars.
// (The motion tracker itself is tested in Rust: ffmpeg::focus_tests.)
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { produce } from "immer";
import * as ops from "../../src/engine/timelineOps";
import { buildExport } from "../../src/engine/exportGraph";
import { defaultExportSettings } from "../../src/engine/presets";
import { createProject, makeMediaClip } from "../../src/engine/defaults";
import { reframeClip, reframeSize, type FocusSample } from "../../src/engine/reframe";
import { followFace, type FaceFrame } from "../../src/engine/faces";
import type { MediaAsset, MediaClip } from "../../src/types/project";

const FF = process.env.FFMPEG || "ffmpeg";
const dir = mkdtempSync(join(tmpdir(), "studiox-m5-"));
const ff = (args: string[]) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
function px(file: string, t: number, x: number, y: number): number[] {
  const buf = execFileSync(FF, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
  return [buf[0], buf[1], buf[2]];
}

let MOVE: MediaAsset, WAVE: MediaAsset, RED: MediaAsset;
beforeAll(() => {
  // white 60×60 box, centre x = 70 + 120·t (of 640), y centre = 180 (of 360), on dark grey
  ff([
    "-f", "lavfi", "-i", "color=c=0x202020:s=640x360:r=25:d=4",
    "-f", "lavfi", "-i", "color=c=white:s=60x60:r=25:d=4",
    "-filter_complex", "[0][1]overlay=x='40+t*120':y=150,format=yuv420p",
    "-c:v", "libx264", join(dir, "move.mp4"),
  ]);
  // white 60×60 "face" swinging left/right: centre x = 320 + 200·sin(πt), y = 180
  ff([
    "-f", "lavfi", "-i", "color=c=0x202020:s=640x360:r=25:d=4",
    "-f", "lavfi", "-i", "color=c=white:s=60x60:r=25:d=4",
    "-filter_complex", "[0][1]overlay=x='290+200*sin(PI*t)':y=150,format=yuv420p",
    "-c:v", "libx264", join(dir, "wave.mp4"),
  ]);
  ff(["-f", "lavfi", "-i", "color=c=red:s=40x40", "-frames:v", "1", join(dir, "red.png")]);
  WAVE = { id: "wave", path: join(dir, "wave.mp4"), name: "wave", kind: "video", duration: 4, width: 640, height: 360, fps: 25, hasVideo: true, hasAudio: false, size: 1, mtime: 1, addedAt: 0 };
  RED = { id: "red", path: join(dir, "red.png"), name: "red", kind: "image", duration: 0, width: 40, height: 40, fps: 25, hasVideo: true, hasAudio: false, size: 1, mtime: 1, addedAt: 0 };
  MOVE = { id: "move", path: join(dir, "move.mp4"), name: "move", kind: "video", duration: 4, width: 640, height: 360, fps: 25, hasVideo: true, hasAudio: false, size: 1, mtime: 1, addedAt: 0 };
});

describe("M5/M6 tracking export", () => {
  it("vertical output follows the moving subject", () => {
    const { width: W, height: H } = reframeSize(640, 360, { w: 9, h: 16 });
    expect([W, H]).toEqual([360, 640]);
    let p = createProject("M5", { width: W, height: H, fps: 25 });
    p.media.push(MOVE);
    const v1 = p.tracks[2].id;
    const c: MediaClip = makeMediaClip(MOVE, v1, 0, 25);
    c.duration = 4;
    const samples: FocusSample[] = Array.from({ length: 17 }, (_, i) => ({ t: i / 4, x: (70 + 120 * (i / 4)) / 640, y: 0.5, weight: 1 }));
    // step 0.1 s → 40 keyframes: also proves long keyframe expressions are accepted by FFmpeg
    const r = reframeClip(c, MOVE, W, H, samples, 0.1);
    expect(r.kx!.length).toBeGreaterThan(20);
    c.transform.scale = r.scale;
    c.transform.x = r.x;
    c.keyframes = { x: r.kx };
    p = produce(p, (d) => void ops.addClip(d, c));

    const S = { ...defaultExportSettings(W, H, 25), width: W, height: H, fps: 25, speedPreset: "fast" as const };
    const plan = buildExport(p, S, {}, {});
    const script = join(dir, "reframe.txt");
    writeFileSync(script, plan.filterGraph);
    const out = join(dir, "reframe.mp4");
    try {
      execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...plan.inputArgs, "-filter_complex_script", script, ...plan.outputArgs, out], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      throw new Error(`FFmpeg failed:\n${e.stderr?.toString()}\n${plan.filterGraph}`);
    }
    // the box (≈107 px wide after scaling) stays at the centre while it crosses the frame
    for (const t of [1, 2, 3]) {
      const [rr, gg, bb] = px(out, t, W / 2, H / 2);
      expect(Math.min(rr, gg, bb), `centre at ${t}s`).toBeGreaterThan(200);
    }
    // the picture covers the whole canvas (no black bars at the corners)
    for (const [x, y] of [[1, 1], [W - 2, H - 2], [1, H - 2], [W - 2, 1]]) {
      const [rr] = px(out, 2, x, y);
      expect(rr, `corner ${x},${y}`).toBeGreaterThan(18);
    }
  });

  it("an overlay follows a face along a curved path (many keyframes)", () => {
    let p = createProject("M6", { width: 640, height: 360, fps: 25 });
    p.media.push(WAVE, RED);
    const v2 = p.tracks[1].id, v1 = p.tracks[2].id;
    const base = makeMediaClip(WAVE, v1, 0, 25);
    base.duration = 4;
    const ov = makeMediaClip(RED, v2, 0, 25);
    ov.duration = 4;
    // image clips are fitted to the canvas: scale so the 40 px square stays 40 px on 640×360
    ov.transform.scale = 40 / 360;
    ov.transform.x = 0; // starts exactly on the face (centre x 320)
    const frames: FaceFrame[] = Array.from({ length: 33 }, (_, i) => {
      const t = i / 8;
      const cx = (320 + 200 * Math.sin(Math.PI * t)) / 640;
      return { t, faces: [{ x: cx - 30 / 640, y: 150 / 360, w: 60 / 640, h: 60 / 360, score: 0.9 }] };
    });
    const r = followFace(ov, base, WAVE, 640, 360, frames, 0)!;
    expect(r.x.length).toBeGreaterThan(15);
    ov.keyframes = { x: r.x, y: r.y };
    p = produce(p, (d) => {
      ops.addClip(d, base);
      ops.addClip(d, ov);
    });
    const S = { ...defaultExportSettings(640, 360, 25), width: 640, height: 360, fps: 25, speedPreset: "fast" as const };
    const plan = buildExport(p, S, {}, {});
    const script = join(dir, "follow.txt");
    writeFileSync(script, plan.filterGraph);
    const out = join(dir, "follow.mp4");
    try {
      execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...plan.inputArgs, "-filter_complex_script", script, ...plan.outputArgs, out], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      throw new Error(`FFmpeg failed:\n${e.stderr?.toString()}`);
    }
    for (const t of [0.52, 1.52, 2.24, 3.04]) {
      const cx = Math.round(320 + 200 * Math.sin(Math.PI * t));
      const [rr, gg, bb] = px(out, t, cx, 180);
      expect(rr > 180 && gg < 90 && bb < 90, `red sticker on the face at ${t}s (x=${cx}): ${[rr, gg, bb]}`).toBe(true);
    }
  });
});
