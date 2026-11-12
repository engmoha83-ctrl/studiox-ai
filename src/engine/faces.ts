// Face tracks (from the Rust YuNet detector) → focus samples for smart reframe and
// position/scale keyframes that make an overlay follow a person. Pure module, unit tested.
import { evalKf } from "./keyframes";
import { mediaRect } from "./segments";
import type { FocusSample } from "./reframe";
import type { Keyframe, MediaAsset, MediaClip } from "../types/project";

export interface FaceBox {
  /** top-left + size, fractions of the source frame */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}
export interface FaceFrame {
  /** seconds from the analysed range start (source time) */
  t: number;
  faces: FaceBox[];
}

export const faceCoverage = (frames: FaceFrame[]) => (frames.length ? frames.filter((f) => f.faces.length).length / frames.length : 0);

/**
 * Follow ONE person through the shot: start with the most prominent face, then in each frame
 * take the face closest to where that person was (so the camera doesn't jump between people).
 * A clearly more prominent face that persists takes over (e.g. a new speaker walks in front).
 * Frames without a matching face get weight 0 (the reframe smoother holds the last position).
 */
export function primaryFaceTrack(frames: FaceFrame[]): (FocusSample & { size: number })[] {
  const prominence = (f: FaceBox) => f.w * f.h * f.score;
  let cur: FaceBox | null = null;
  let challenger: { face: FaceBox; count: number } | null = null;
  return frames.map((fr) => {
    if (!fr.faces.length) return { t: fr.t, x: cur ? cur.x + cur.w / 2 : 0.5, y: cur ? cur.y + cur.h / 2 : 0.5, weight: 0, size: cur?.w ?? 0 };
    if (!cur) {
      cur = [...fr.faces].sort((a, b) => prominence(b) - prominence(a))[0];
    } else {
      const c = cur;
      const dist = (f: FaceBox) => Math.hypot(f.x + f.w / 2 - (c.x + c.w / 2), f.y + f.h / 2 - (c.y + c.h / 2)) / Math.max(c.w, 0.02);
      const near = [...fr.faces].sort((a, b) => dist(a) - dist(b))[0];
      const top = [...fr.faces].sort((a, b) => prominence(b) - prominence(a))[0];
      if (top !== near && prominence(top) > prominence(near) * 2.5) {
        challenger = challenger && Math.abs(challenger.face.x - top.x) < top.w ? { face: top, count: challenger.count + 1 } : { face: top, count: 1 };
      } else challenger = null;
      if (challenger && challenger.count >= 3) {
        cur = top;
        challenger = null;
      } else cur = dist(near) < 2.5 ? near : cur;
    }
    const f = cur!;
    const matched = fr.faces.includes(f);
    return { t: fr.t, x: f.x + f.w / 2, y: f.y + f.h / 2, weight: matched ? 1 : 0, size: f.w };
  });
}

/** Ramer–Douglas–Peucker on (t, v) so dense tracks become few keyframes within `tol`. */
export function simplify(points: { t: number; v: number }[], tol: number): { t: number; v: number }[] {
  if (points.length <= 2) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const u = (points[i].t - points[a].t) / (points[b].t - points[a].t || 1e-9);
      const err = Math.abs(points[i].v - (points[a].v + (points[b].v - points[a].v) * u));
      if (err > worst) [worst, idx] = [err, i];
    }
    if (worst > tol) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export interface FollowResult {
  x: Keyframe[];
  y: Keyframe[];
  scale?: Keyframe[];
  /** frames where the face was found */
  found: number;
}

/**
 * Keyframes that make `overlay` follow the main face of `base` (a video clip below it).
 * The overlay keeps the offset it has from the face at the first detection; with `withScale`
 * it also grows/shrinks with the face. Samples are in base-clip source time from `srcStart`.
 */
export function followFace(
  overlay: MediaClip,
  base: MediaClip,
  baseMedia: Pick<MediaAsset, "width" | "height">,
  W: number,
  H: number,
  frames: FaceFrame[],
  srcStart: number,
  withScale = false,
): FollowResult | null {
  const track = primaryFaceTrack(frames);
  const found = track.filter((s) => s.weight > 0).length;
  if (!found) return null;
  // light smoothing (stickers must stick, so no dead-zone): average with direct neighbours
  const sm = track.map((s, i) => {
    // only between two detections (ends are kept exact)
    if (s.weight === 0 || !(track[i - 1]?.weight > 0) || !(track[i + 1]?.weight > 0)) return s;
    const nb = [track[i - 1], s, track[i + 1]];
    return { ...s, x: nb.reduce((a, b) => a + b.x, 0) / nb.length, y: nb.reduce((a, b) => a + b.y, 0) / nb.length, size: nb.reduce((a, b) => a + b.size, 0) / nb.length };
  });
  const cr = base.crop;
  const cw = Math.max(1e-6, 1 - cr.left - cr.right);
  const ch = Math.max(1e-6, 1 - cr.top - cr.bottom);
  /** face centre in canvas pixels, relative to the canvas centre, at timeline time t */
  const faceAt = (tl: number, fx: number, fy: number, size: number) => {
    const local = tl - base.start;
    const tf = {
      x: evalKf(base.keyframes?.x, local, base.transform.x),
      y: evalKf(base.keyframes?.y, local, base.transform.y),
      scale: evalKf(base.keyframes?.scale, local, base.transform.scale),
    };
    const rot = (evalKf(base.keyframes?.rotation, local, base.transform.rotation) * Math.PI) / 180;
    const r = mediaRect(baseMedia.width, baseMedia.height, base, W, H, 1, tf);
    let dx = ((fx - cr.left) / cw - 0.5) * r.w * (base.transform.flipH ? -1 : 1);
    let dy = ((fy - cr.top) / ch - 0.5) * r.h * (base.transform.flipV ? -1 : 1);
    [dx, dy] = [dx * Math.cos(rot) - dy * Math.sin(rot), dx * Math.sin(rot) + dy * Math.cos(rot)];
    return { x: r.cx - W / 2 + dx, y: r.cy - H / 2 + dy, size: (size / cw) * r.w };
  };
  const pts = sm
    .map((s) => ({ s, tl: base.start + (srcStart + s.t - base.in) / base.speed }))
    .filter(({ tl }) => tl >= overlay.start - 1e-6 && tl <= overlay.start + overlay.duration + 1e-6)
    .map(({ s, tl }) => ({ tl, local: tl - overlay.start, ok: s.weight > 0, ...faceAt(tl, s.x, s.y, s.size) }));
  const first = pts.find((p) => p.ok);
  if (!first) return null;
  const ox = evalKf(overlay.keyframes?.x, first.local, overlay.transform.x) - first.x;
  const oy = evalKf(overlay.keyframes?.y, first.local, overlay.transform.y) - first.y;
  const s0 = evalKf(overlay.keyframes?.scale, first.local, overlay.transform.scale);
  const k = (list: { t: number; v: number }[], tol: number): Keyframe[] => simplify(list, tol).map((p) => ({ t: +p.t.toFixed(4), v: +p.v.toFixed(2), ease: "linear" }));
  const xs = pts.map((p) => ({ t: p.local, v: p.x + (withScale ? (ox * p.size) / first.size : ox) }));
  const ys = pts.map((p) => ({ t: p.local, v: p.y + (withScale ? (oy * p.size) / first.size : oy) }));
  return {
    x: k(xs, 2),
    y: k(ys, 2),
    scale: withScale ? k(pts.map((p) => ({ t: p.local, v: (s0 * p.size) / first.size })), 0.01) : undefined,
    found,
  };
}
