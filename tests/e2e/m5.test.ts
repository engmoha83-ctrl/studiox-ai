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
import type { MediaAsset, MediaClip } from "../../src/types/project";

const FF = process.env.FFMPEG || "ffmpeg";
const dir = mkdtempSync(join(tmpdir(), "studiox-m5-"));
const ff = (args: string[]) => execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
function px(file: string, t: number, x: number, y: number): number[] {
  const buf = execFileSync(FF, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
  return [buf[0], buf[1], buf[2]];
}

let MOVE: MediaAsset;
beforeAll(() => {
  // white 60×60 box, centre x = 70 + 120·t (of 640), y centre = 180 (of 360), on dark grey
  ff([
    "-f", "lavfi", "-i", "color=c=0x202020:s=640x360:r=25:d=4",
    "-f", "lavfi", "-i", "color=c=white:s=60x60:r=25:d=4",
    "-filter_complex", "[0][1]overlay=x='40+t*120':y=150,format=yuv420p",
    "-c:v", "libx264", join(dir, "move.mp4"),
  ]);
  MOVE = { id: "move", path: join(dir, "move.mp4"), name: "move", kind: "video", duration: 4, width: 640, height: 360, fps: 25, hasVideo: true, hasAudio: false, size: 1, mtime: 1, addedAt: 0 };
});

describe("M5 smart reframe export", () => {
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
});
