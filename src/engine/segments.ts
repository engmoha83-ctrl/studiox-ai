// Render resolver shared by the preview compositor and the FFmpeg export graph.
// Anything that affects *what a frame looks like* must be computed here so
// the preview and the rendered file stay identical.

import { isMediaClip, isTextClip, type Clip, type MediaAsset, type Project, type TextAnimation, type Track, type Transition } from "../types/project";
import { clipEnd, mediaOf, previousAdjacent } from "./timelineOps";
import { evalKf } from "./keyframes";

export interface Curve {
  start: number; // timeline seconds
  dur: number;
}
export interface SlideCurve extends Curve {
  /** offset in canvas pixels at the "away" end of the animation */
  dx: number;
  dy: number;
}
export interface LayerAnim {
  fadeIn?: Curve;
  fadeOut?: Curve;
  slideIn?: SlideCurve;
  slideOut?: SlideCurve;
}

export interface RenderLayer {
  clip: Clip;
  track: Track;
  media?: MediaAsset;
  /** timeline range in which the layer is drawn (may extend past clip end for transitions) */
  windowStart: number;
  windowEnd: number;
  anim: LayerAnim;
}

export interface AudioSegment {
  clip: Clip & { type: "media" };
  media: MediaAsset;
  start: number;
  duration: number;
  in: number;
  speed: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
}

const TEXT_SLIDE = 0.06; // fraction of canvas height

/** Transition types that overlap the previous adjacent clip. */
export const overlapsPrevious = (t?: Transition | null) => !!t && t.type !== "fade";

function textAnim(kind: TextAnimation, d: number, start: number, H: number, isIn: boolean): Partial<LayerAnim> {
  if (kind === "none" || d <= 0) return {};
  const curve = { start, dur: d };
  const res: Partial<LayerAnim> = isIn ? { fadeIn: curve } : { fadeOut: curve };
  if (kind === "slide-up" || kind === "slide-down") {
    const dy = (kind === "slide-up" ? 1 : -1) * TEXT_SLIDE * H * (isIn ? 1 : -1);
    if (isIn) res.slideIn = { ...curve, dx: 0, dy };
    else res.slideOut = { ...curve, dx: 0, dy };
  }
  return res;
}

function transitionAnim(tr: Transition | null | undefined, c: Clip, W: number, H: number, isIn: boolean): Partial<LayerAnim> {
  if (!tr || tr.duration <= 0) return {};
  const d = Math.min(tr.duration, c.duration);
  const curve = isIn ? { start: c.start, dur: d } : { start: clipEnd(c) - d, dur: d };
  if (tr.type === "fade" || tr.type === "dissolve") return isIn ? { fadeIn: curve } : { fadeOut: curve };
  const dir: Record<string, [number, number]> = {
    "slide-left": [W, 0],
    "slide-right": [-W, 0],
    "slide-up": [0, H],
    "slide-down": [0, -H],
  };
  const [dx, dy] = dir[tr.type] ?? [0, 0];
  // In: the clip enters from (dx,dy). Out: it leaves towards (-dx,-dy).
  return isIn ? { slideIn: { ...curve, dx, dy } } : { slideOut: { ...curve, dx: -dx, dy: -dy } };
}

/** All visual layers in draw order (bottom → top). */
export function videoLayers(p: Project, canvasW = p.settings.width, canvasH = p.settings.height): RenderLayer[] {
  const layers: RenderLayer[] = [];
  const visual = p.tracks.filter((t) => t.kind !== "audio" && !t.hidden);
  for (let i = visual.length - 1; i >= 0; i--) {
    const track = visual[i];
    const clips = Object.values(p.clips)
      .filter((c) => c.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      const media = mediaOf(p, clip);
      if (isMediaClip(clip) && (!media || media.kind === "audio")) continue;
      // tail extension: the next adjacent clip overlaps us with its transition
      const next = clips.find((o) => o.id !== clip.id && overlapsPrevious(o.transitionIn) && previousAdjacent(p, o)?.id === clip.id);
      const ext = next ? Math.min(next.transitionIn!.duration, next.duration) : 0;
      let anim: LayerAnim = {};
      if (isTextClip(clip)) {
        const d = Math.min(clip.animDuration, clip.duration / 2);
        anim = { ...textAnim(clip.animIn, d, clip.start, canvasH, true), ...textAnim(clip.animOut, d, clipEnd(clip) - d, canvasH, false) };
      }
      anim = {
        ...anim,
        ...transitionAnim(clip.transitionIn, clip, canvasW, canvasH, true),
        ...transitionAnim(clip.transitionOut, clip, canvasW, canvasH, false),
      };
      layers.push({ clip, track, media, windowStart: clip.start, windowEnd: clipEnd(clip) + ext, anim });
    }
  }
  return layers;
}

export function audioSegments(p: Project): AudioSegment[] {
  const out: AudioSegment[] = [];
  const anySolo = p.tracks.some((t) => t.solo);
  for (const c of Object.values(p.clips)) {
    if (!isMediaClip(c) || c.muted) continue;
    const track = p.tracks.find((t) => t.id === c.trackId);
    const m = mediaOf(p, c);
    if (!track || track.muted || (anySolo && !track.solo) || !m || !m.hasAudio || m.kind === "image") continue;
    const gain = c.volume * track.volume;
    if (gain <= 0 && !c.keyframes?.volume?.length) continue;
    out.push({
      clip: c,
      media: m,
      start: c.start,
      duration: c.duration,
      in: c.in,
      speed: c.speed,
      gain,
      fadeIn: Math.min(c.audioFadeIn, c.duration),
      fadeOut: Math.min(c.audioFadeOut, c.duration),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------- numeric evaluation (preview)

export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const prog = (t: number, c: Curve) => Math.min(1, Math.max(0, (t - c.start) / c.dur));

export interface LayerState {
  alpha: number;
  dx: number;
  dy: number;
  /** source media time for video layers */
  sourceTime: number;
  /** effective (keyframed) transform for media layers */
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export function evalLayer(layer: RenderLayer, t: number): LayerState {
  const { clip, anim } = layer;
  const local = t - clip.start;
  const kf = isMediaClip(clip) ? clip.keyframes : undefined;
  let alpha = evalKf(kf?.opacity, local, clip.opacity);
  let dx = 0;
  let dy = 0;
  if (anim.fadeIn) alpha *= prog(t, anim.fadeIn);
  if (anim.fadeOut) alpha *= 1 - prog(t, anim.fadeOut);
  if (anim.slideIn) {
    const k = 1 - easeInOut(prog(t, anim.slideIn));
    dx += anim.slideIn.dx * k;
    dy += anim.slideIn.dy * k;
  }
  if (anim.slideOut) {
    const k = easeInOut(prog(t, anim.slideOut));
    dx += anim.slideOut.dx * k;
    dy += anim.slideOut.dy * k;
  }
  let sourceTime = 0;
  let x = 0, y = 0, scale = 1, rotation = 0;
  if (isMediaClip(clip)) {
    sourceTime = clip.in + (t - clip.start) * clip.speed;
    if (layer.media && layer.media.kind === "video") sourceTime = Math.min(sourceTime, Math.max(0, layer.media.duration - 0.001));
    x = evalKf(kf?.x, local, clip.transform.x);
    y = evalKf(kf?.y, local, clip.transform.y);
    scale = evalKf(kf?.scale, local, clip.transform.scale);
    rotation = evalKf(kf?.rotation, local, clip.transform.rotation);
  }
  return { alpha: Math.max(0, Math.min(1, alpha)), dx, dy, sourceTime, x, y, scale, rotation };
}

export function layersAt(layers: RenderLayer[], t: number): RenderLayer[] {
  return layers.filter((l) => t >= l.windowStart - 1e-6 && t < l.windowEnd - 1e-6);
}

// ------------------------------------------------------------- geometry (shared)

export interface Rect {
  /** centre of the drawn image, canvas px */
  cx: number;
  cy: number;
  /** drawn size, canvas px (before rotation) */
  w: number;
  h: number;
  /** source crop rect, source px */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Fit (contain) the cropped source into the canvas, then apply the clip transform (optionally keyframed). */
export function mediaRect(srcW: number, srcH: number, clip: Clip & { type: "media" }, W: number, H: number, unit = 1, tf?: { x: number; y: number; scale: number }): Rect {
  const cr = clip.crop;
  const sx = srcW * cr.left;
  const sy = srcH * cr.top;
  const sw = Math.max(1, srcW * (1 - cr.left - cr.right));
  const sh = Math.max(1, srcH * (1 - cr.top - cr.bottom));
  const fit = Math.min(W / sw, H / sh);
  const t = tf ?? clip.transform;
  const s = fit * t.scale;
  return { cx: W / 2 + t.x * unit, cy: H / 2 + t.y * unit, w: sw * s, h: sh * s, sx, sy, sw, sh };
}
