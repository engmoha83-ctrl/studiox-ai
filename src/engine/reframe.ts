// Smart reframe: change the project aspect ratio and keep the interesting part of every
// shot in frame. Focus samples come from the Rust `analyze_focus` command (motion + detail
// centroid per frame); this module turns them into a cover scale and x/y keyframes.
import type { Keyframe, MediaAsset, MediaClip } from "../types/project";

export interface FocusSample {
  /** seconds from the analysed range start (source time) */
  t: number;
  /** focus point, 0..1 of the full source frame */
  x: number;
  y: number;
  /** how much motion/detail the frame has (0 = flat/unknown) */
  weight: number;
}

export interface Aspect {
  id: "9:16" | "1:1" | "4:5" | "16:9";
  w: number;
  h: number;
  name: string;
}

export const REFRAME_ASPECTS: Aspect[] = [
  { id: "9:16", w: 9, h: 16, name: "Vertical 9:16 (TikTok, Reels, Shorts)" },
  { id: "1:1", w: 1, h: 1, name: "Square 1:1" },
  { id: "4:5", w: 4, h: 5, name: "Portrait 4:5 (Instagram feed)" },
  { id: "16:9", w: 16, h: 9, name: "Landscape 16:9 (YouTube)" },
];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** New canvas size for an aspect ratio, keeping the current short side (1080p stays 1080p). */
export function reframeSize(curW: number, curH: number, a: Pick<Aspect, "w" | "h">): { width: number; height: number } {
  const short = Math.min(curW, curH);
  if (a.w <= a.h) return { width: even(short), height: even((short * a.h) / a.w) };
  return { width: even((short * a.w) / a.h), height: even(short) };
}

/**
 * Smooth the raw focus track so the virtual camera does not shake:
 * 1. frames with almost no signal inherit the previous position,
 * 2. a weighted moving average over ±radius samples,
 * 3. a dead-zone: the camera only moves when the subject leaves a small window.
 */
export function smoothFocus(samples: FocusSample[], radius = 4, deadZone = 0.06): FocusSample[] {
  if (!samples.length) return [];
  const maxW = Math.max(...samples.map((s) => s.weight), 1e-9);
  // 1. hold through low-signal frames
  const held: FocusSample[] = [];
  let last = { x: 0.5, y: 0.5 };
  const firstGood = samples.find((s) => s.weight > maxW * 0.05);
  if (firstGood) last = { x: firstGood.x, y: firstGood.y };
  for (const s of samples) {
    if (s.weight > maxW * 0.05) last = { x: s.x, y: s.y };
    held.push({ ...s, x: last.x, y: last.y });
  }
  // 2. weighted moving average (weights floored so quiet frames still count a little)
  const avg = held.map((s, i) => {
    let sx = 0, sy = 0, sw = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(held.length - 1, i + radius); j++) {
      const w = Math.max(held[j].weight / maxW, 0.15) * (1 - Math.abs(j - i) / (radius + 1));
      sx += held[j].x * w;
      sy += held[j].y * w;
      sw += w;
    }
    return { ...s, x: sx / sw, y: sy / sw };
  });
  // 3. dead-zone camera
  let cx = avg[0].x, cy = avg[0].y;
  return avg.map((s) => {
    if (Math.abs(s.x - cx) > deadZone) cx = s.x - Math.sign(s.x - cx) * deadZone;
    if (Math.abs(s.y - cy) > deadZone) cy = s.y - Math.sign(s.y - cy) * deadZone;
    return { ...s, x: cx, y: cy };
  });
}

export interface ReframeResult {
  scale: number;
  x: number;
  y: number;
  kx?: Keyframe[];
  ky?: Keyframe[];
}

/** Can this clip be reframed automatically? Clips the user already positioned are left alone. */
export function canReframe(c: MediaClip, m?: MediaAsset): boolean {
  if (!m || m.kind === "audio" || !m.width || !m.height) return false;
  const t = c.transform;
  const kf = c.keyframes;
  return Math.abs(t.scale - 1) < 1e-3 && Math.abs(t.x) < 0.5 && Math.abs(t.y) < 0.5 && Math.abs(t.rotation) < 1e-3 && !kf?.x?.length && !kf?.y?.length && !kf?.scale?.length && !kf?.rotation?.length;
}

/**
 * Cover-fill the W×H canvas with the clip and pan so the (smoothed) focus point stays as close
 * to the centre as the frame edges allow. Keyframes are clip-local timeline seconds.
 */
export function reframeClip(c: MediaClip, m: Pick<MediaAsset, "width" | "height">, W: number, H: number, samples: FocusSample[], step = 1): ReframeResult {
  const cr = c.crop;
  const cw = Math.max(1e-6, 1 - cr.left - cr.right);
  const ch = Math.max(1e-6, 1 - cr.top - cr.bottom);
  const sw = m.width * cw;
  const sh = m.height * ch;
  const fit = Math.min(W / sw, H / sh);
  const cover = Math.max(W / sw, H / sh);
  const scale = cover / fit;
  const dw = sw * cover;
  const dh = sh * cover;
  const maxX = Math.max(0, (dw - W) / 2);
  const maxY = Math.max(0, (dh - H) / 2);
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  const offX = (fx: number) => {
    const u = Math.max(0, Math.min(1, (fx - cr.left) / cw)) - 0.5;
    return clamp((c.transform.flipH ? 1 : -1) * u * dw, maxX);
  };
  const offY = (fy: number) => {
    const u = Math.max(0, Math.min(1, (fy - cr.top) / ch)) - 0.5;
    return clamp((c.transform.flipV ? 1 : -1) * u * dh, maxY);
  };
  // dead-zone = 8% of the visible window, so the camera reacts at a sensible on-screen distance
  const rate = samples.length > 1 ? 1 / Math.max(1e-3, samples[1].t - samples[0].t) : 4;
  const smooth = smoothFocus(samples, Math.max(1, Math.round(rate)), 0.08 * Math.min(W / dw, H / dh));
  if (!smooth.length) return { scale, x: 0, y: 0 };

  // resample on a regular clip-local grid (source t → timeline t is t / speed)
  const at = (local: number) => {
    const src = local * c.speed;
    let i = 0;
    while (i < smooth.length - 1 && smooth[i + 1].t <= src) i++;
    const a = smooth[i];
    const b = smooth[Math.min(i + 1, smooth.length - 1)];
    const u = b.t > a.t ? Math.max(0, Math.min(1, (src - a.t) / (b.t - a.t))) : 0;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };
  // keep expressions small: at most ~40 keyframes per axis
  const dt = Math.max(step, c.duration / 40);
  const grid: number[] = [];
  for (let t = 0; t < c.duration - 1e-6; t += dt) grid.push(+t.toFixed(4));
  if (c.duration - grid[grid.length - 1] > dt * 0.25) grid.push(+c.duration.toFixed(4));

  const axis = (get: (p: { x: number; y: number }) => number, off: (v: number) => number, lim: number): { base: number; kfs?: Keyframe[] } => {
    const vals = grid.map((t) => Math.round(off(get(at(t)))) || 0);
    if (lim < 0.5 || Math.max(...vals) - Math.min(...vals) < 2) return { base: vals[0] ?? 0 };
    const kfs: Keyframe[] = [];
    vals.forEach((v, i) => {
      const prev = kfs[kfs.length - 1];
      const next = vals[i + 1];
      // drop points on a straight hold (same as neighbours) to keep the list short
      if (prev && Math.abs(prev.v - v) < 2 && next !== undefined && Math.abs(next - v) < 2) return;
      kfs.push({ t: grid[i], v, ease: "ease-in-out" });
    });
    // continuous pans stay linear (no stop-and-go each second); starts/stops are eased
    for (let i = 0; i < kfs.length - 1; i++) {
      const d = Math.sign(kfs[i + 1].v - kfs[i].v);
      const before = i > 0 ? Math.sign(kfs[i].v - kfs[i - 1].v) : 0;
      const after = i + 2 < kfs.length ? Math.sign(kfs[i + 2].v - kfs[i + 1].v) : 0;
      kfs[i].ease = d !== 0 && before === d && after === d ? "linear" : d !== 0 && before === d ? "ease-out" : d !== 0 && after === d ? "ease-in" : "ease-in-out";
    }
    return { base: vals[0], kfs: kfs.length > 1 ? kfs : undefined };
  };
  const ax = axis((p) => p.x, offX, maxX);
  const ay = axis((p) => p.y, offY, maxY);
  return { scale, x: ax.base, y: ay.base, kx: ax.kfs, ky: ay.kfs };
}
