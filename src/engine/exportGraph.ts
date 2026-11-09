// Builds the FFmpeg command (inputs, filter graph, outputs) for a project.
// Pure function — unit tested in tests/exportGraph.test.ts and executed with a
// real FFmpeg in scripts/e2e-export.mjs.

import { isMediaClip, isTextClip, type Clip, type MediaClip, type Project, type TextClip } from "../types/project";
import { hasKf, kfExpr } from "./keyframes";
import { isColorIdentity } from "./color";
import { audioSegments, mediaRect, videoLayers, type LayerAnim, type RenderLayer } from "./segments";
import { codecFamily, type ExportSettings } from "./presets";
import { projectDuration } from "./timelineOps";

export interface ExportPlan {
  inputArgs: string[];
  filterGraph: string;
  outputArgs: string[];
  duration: number;
  compWidth: number;
  compHeight: number;
  unit: number;
}

const f = (n: number, d = 6) => {
  const s = n.toFixed(d);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Composition size: project aspect fitted into the output size. */
export function compositionSize(p: Project, s: ExportSettings) {
  const unit = Math.min(s.width / p.settings.width, s.height / p.settings.height);
  return { unit, w: even(p.settings.width * unit), h: even(p.settings.height * unit) };
}

/** Text clips that need a rasterised PNG for this export. */
export function textLayersFor(p: Project): string[] {
  // every text clip is rasterised; batchable ones are then streamed through one concat input per track
  return videoLayers(p)
    .filter((l) => isTextClip(l.clip))
    .map((l) => l.clip.id);
}

export const textFileName = (clipId: string) => `text_${clipId}.png`;

/** Text clips without animation/transition are merged per track into ONE concat stream (subtitles). */
export function isBatchableText(c: Clip): c is TextClip {
  return isTextClip(c) && c.animIn === "none" && c.animOut === "none" && !c.transitionIn && !c.transitionOut && c.opacity >= 0.999;
}

/** ffconcat list: blank gaps + one PNG per cue, starting at t=0. */
export function concatList(entries: { start: number; end: number; png: string }[], blank: string): string {
  const q = (p: string) => `'${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
  const lines = ["ffconcat version 1.0"];
  let t = 0;
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  for (const e of sorted) {
    if (e.start > t + 1e-4) lines.push(`file ${q(blank)}`, `duration ${f(e.start - t)}`);
    lines.push(`file ${q(e.png)}`, `duration ${f(e.end - Math.max(t, e.start))}`);
    t = e.end;
  }
  lines.push(`file ${q(blank)}`, "duration 1", `file ${q(blank)}`);
  return lines.join("\n") + "\n";
}

/** Extra per-clip files produced before export (see services/exporter). */
export interface ClipAssets {
  lut?: string; // .cube
  vignette?: string; // png at layer pixel size
  mask?: string; // png at layer pixel size (alpha = mask)
}

/** Escape a file path for use inside a filtergraph option value. */
export function ffPath(path: string): string {
  return `'${path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`;
}

const PAD = 2;

/** Pixel size the media layer is rendered at before positioning (shared with asset rendering). */
export function layerPixelSize(_p: Project, clip: MediaClip, srcW: number, srcH: number, CW: number, CH: number, unit: number) {
  const kfScale = clip.keyframes?.scale?.length ? Math.max(clip.transform.scale, ...clip.keyframes.scale.map((k) => k.v)) : clip.transform.scale;
  const r = mediaRect(srcW, srcH, clip, CW, CH, unit, { x: 0, y: 0, scale: Math.min(kfScale, 8) });
  return { w: Math.max(2, Math.round(r.w)), h: Math.max(2, Math.round(r.h)), maxScale: Math.min(kfScale, 8), rect: r };
}

/** Does the clip animate its geometry with keyframes? */
const geomKf = (c: MediaClip) => hasKf(c, "x") || hasKf(c, "y") || hasKf(c, "scale") || hasKf(c, "rotation");

export function needsAssets(c: MediaClip) {
  return {
    lut: !isColorIdentity(c.color),
    vignette: !!c.effects?.some((e) => e.enabled && e.type === "vignette" && e.amount > 0),
    mask: !!c.mask,
  };
}

function escapeColor(c: string) {
  return c.startsWith("#") ? `0x${c.slice(1)}` : c;
}

/** FFmpeg expression for a clamped linear progress 0..1 of a curve at time t. */
const progExpr = (start: number, dur: number) => `clip((t-${f(start)})/${f(dur)},0,1)`;
const easeExpr = (u: string) => `if(lt(${u},0.5),4*pow(${u},3),1-pow(-2*${u}+2,3)/2)`;

function slideExpr(anim: LayerAnim, axis: "dx" | "dy"): string {
  const parts: string[] = [];
  if (anim.slideIn && anim.slideIn[axis]) parts.push(`${f(anim.slideIn[axis], 3)}*(1-${easeExpr(progExpr(anim.slideIn.start, anim.slideIn.dur))})`);
  if (anim.slideOut && anim.slideOut[axis]) parts.push(`${f(anim.slideOut[axis], 3)}*${easeExpr(progExpr(anim.slideOut.start, anim.slideOut.dur))}`);
  return parts.length ? parts.join("+") : "0";
}

function scaleAnim(anim: LayerAnim, unit: number): LayerAnim {
  const sc = (c?: { start: number; dur: number; dx: number; dy: number }) => (c ? { ...c, dx: c.dx * unit, dy: c.dy * unit } : undefined);
  return { ...anim, slideIn: sc(anim.slideIn), slideOut: sc(anim.slideOut) };
}

/** Does this layer need an alpha channel (opacity, fades, rotation corners)? */
function needsAlpha(layer: RenderLayer): boolean {
  const c = layer.clip;
  const rot = c.type === "media" ? ((c.transform.rotation % 360) + 360) % 360 : 0;
  const media = c.type === "media" && (!!c.chromaKey?.enabled || !!c.mask || hasKf(c) || !!c.effects?.some((e) => e.enabled && e.type === "vignette"));
  return c.opacity < 0.999 || !!layer.anim.fadeIn || !!layer.anim.fadeOut || rot !== 0 || media;
}

function alphaFilters(layer: RenderLayer, rgba: boolean): string[] {
  const out: string[] = [];
  const op = layer.clip.opacity;
  const opKf = layer.clip.type === "media" ? layer.clip.keyframes?.opacity : undefined;
  if (opKf?.length) {
    // per-frame opacity (T = clip-local time at this point of the chain)
    out.push(`geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip(${kfExpr(opKf, op, "T")},0,1)'`);
  } else if (op < 0.999) {
    // planar YUV+alpha is much cheaper than RGBA for video layers; text PNGs stay RGBA
    out.push(rgba ? `colorchannelmixer=aa=${f(Math.max(0, op), 4)}` : `lutyuv=a=val*${f(Math.max(0, op), 4)}`);
  }
  const ws = layer.windowStart;
  if (layer.anim.fadeIn) out.push(`fade=t=in:st=${f(layer.anim.fadeIn.start - ws)}:d=${f(layer.anim.fadeIn.dur)}:alpha=1`);
  if (layer.anim.fadeOut) out.push(`fade=t=out:st=${f(layer.anim.fadeOut.start - ws)}:d=${f(layer.anim.fadeOut.dur)}:alpha=1`);
  return out;
}

function masterFx(p: Project): string {
  const m = p.master;
  if (!m) return "";
  let out = "";
  if (Math.abs(m.volume - 1) > 1e-4) out += `,volume=${f(m.volume, 4)}`;
  if (m.limiter) out += ",alimiter=limit=0.95:level=disabled";
  return out;
}

export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2.0 + 1e-9) {
    out.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.5 - 1e-9) {
    out.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${f(s, 6)}`);
  return out;
}

function videoCodecArgs(s: ExportSettings): string[] {
  const enc = s.videoCodec;
  const q = Math.max(0, Math.min(100, s.quality));
  const B = `${Math.round(s.bitrateKbps)}k`;
  const maxB = `${Math.round(s.bitrateKbps * 1.5)}k`;
  const buf = `${Math.round(s.bitrateKbps * 2)}k`;
  const sp = s.speedPreset;
  const a: string[] = ["-c:v", enc];
  const pick = <T,>(fast: T, med: T, slow: T) => (sp === "fast" ? fast : sp === "slow" ? slow : med);
  const fallbackKbps = Math.round((s.width * s.height * s.fps * (0.04 + q * 0.0012)) / 1000);
  switch (enc) {
    case "libx264":
    case "libx265": {
      a.push("-preset", pick("veryfast", "medium", "slow"));
      const crf = Math.round((enc === "libx264" ? 35 : 38) - q * 0.2);
      if (s.rateControl === "crf") a.push("-crf", String(crf));
      else if (s.rateControl === "vbr") a.push("-b:v", B, "-maxrate", maxB, "-bufsize", buf);
      else {
        a.push("-b:v", B, "-minrate", B, "-maxrate", B, "-bufsize", B);
        if (enc === "libx264") a.push("-x264-params", "nal-hrd=cbr:force-cfr=1");
      }
      break;
    }
    case "libvpx-vp9":
      a.push("-deadline", "good", "-cpu-used", pick("4", "2", "1"), "-row-mt", "1");
      if (s.rateControl === "crf") a.push("-crf", String(Math.round(50 - q * 0.3)), "-b:v", "0");
      else if (s.rateControl === "vbr") a.push("-b:v", B, "-maxrate", maxB);
      else a.push("-b:v", B, "-minrate", B, "-maxrate", B);
      break;
    case "libsvtav1":
      a.push("-preset", pick("10", "8", "6"));
      if (s.rateControl === "crf") a.push("-crf", String(Math.round(55 - q * 0.3)));
      else a.push("-b:v", B);
      break;
    case "libaom-av1":
      a.push("-cpu-used", pick("6", "4", "3"), "-row-mt", "1");
      if (s.rateControl === "crf") a.push("-crf", String(Math.round(55 - q * 0.3)), "-b:v", "0");
      else a.push("-b:v", B);
      break;
    case "prores_ks":
      a.push("-profile:v", "3", "-vendor", "apl0");
      break;
    case "prores_videotoolbox":
      a.push("-profile:v", "hq");
      break;
    default:
      if (/_nvenc$/.test(enc)) {
        a.push("-preset", pick("p3", "p5", "p7"));
        if (s.rateControl === "crf") a.push("-rc", "vbr", "-cq", String(Math.round(36 - q * 0.2)), "-b:v", "0");
        else if (s.rateControl === "vbr") a.push("-rc", "vbr", "-b:v", B, "-maxrate", maxB);
        else a.push("-rc", "cbr", "-b:v", B);
      } else if (/_qsv$/.test(enc)) {
        a.push("-preset", pick("veryfast", "medium", "veryslow"));
        if (s.rateControl === "crf") a.push("-global_quality", String(Math.round(35 - q * 0.2)));
        else if (s.rateControl === "vbr") a.push("-b:v", B, "-maxrate", maxB);
        else a.push("-b:v", B, "-maxrate", B);
      } else if (/_amf$/.test(enc)) {
        a.push("-quality", pick("speed", "balanced", "quality"));
        const qp = String(Math.round(36 - q * 0.2));
        if (s.rateControl === "crf") a.push("-rc", "cqp", "-qp_i", qp, "-qp_p", qp, "-qp_b", qp);
        else if (s.rateControl === "vbr") a.push("-rc", "vbr_peak", "-b:v", B, "-maxrate", maxB);
        else a.push("-rc", "cbr", "-b:v", B);
      } else if (/_videotoolbox$/.test(enc)) {
        if (s.rateControl === "crf") a.push("-q:v", String(Math.round(q)));
        else a.push("-b:v", B);
      } else {
        // h264_mf / hevc_mf / libopenh264: bitrate based only
        a.push("-b:v", s.rateControl === "crf" ? `${fallbackKbps}k` : B);
      }
  }
  const fam = codecFamily(enc);
  if (fam === "hevc" && s.container !== "webm") a.push("-tag:v", "hvc1");
  return a;
}

function pixFmtFor(s: ExportSettings) {
  if (codecFamily(s.videoCodec) === "prores") return s.videoCodec === "prores_ks" ? "yuv422p10le" : "p210le";
  if (/_qsv$/.test(s.videoCodec)) return "nv12";
  return "yuv420p";
}

function audioCodecArgs(s: ExportSettings): string[] {
  const a = ["-c:a", s.audioCodec];
  if (!s.audioCodec.startsWith("pcm_") && s.audioCodec !== "alac") a.push("-b:a", `${Math.round(s.audioBitrateKbps)}k`);
  a.push("-ar", String(s.sampleRate), "-ac", "2");
  return a;
}

/**
 * Build an export plan. `textPaths` maps text clip id → rasterised PNG path
 * (produced by textRender.textClipToPng at composition size).
 */
export function buildExport(
  p: Project,
  s: ExportSettings,
  textPaths: Record<string, string>,
  assets: Record<string, ClipAssets> = {},
  /** trackId → ffconcat list path for batched text clips */
  textBatches: Record<string, string> = {},
): ExportPlan {
  const { unit, w: CW, h: CH } = compositionSize(p, s);
  const fps = s.fps;
  const total = Math.max(1 / fps, projectDuration(p));
  const inputs: string[] = [];
  const chains: string[] = [];
  let inputCount = 0;
  const addInput = (args: string[]) => {
    inputs.push(...args);
    return inputCount++;
  };
  const clipInput: Record<string, number> = {};

  chains.push(`color=c=${escapeColor(p.settings.background)}:s=${CW}x${CH}:r=${f(fps)}:d=${f(total)},format=yuv420p[base0]`);
  let base = "base0";
  let layerIdx = 0;

  const batchDone = new Set<string>();
  for (const layer of videoLayers(p, CW, CH)) {
    const clip = layer.clip;
    const L = layer.windowEnd - layer.windowStart;
    if (L <= 0) continue;
    const batch = textBatches[clip.trackId];
    if (batch && isBatchableText(clip)) {
      if (batchDone.has(clip.trackId)) continue;
      batchDone.add(clip.trackId);
      const bi = addInput(["-f", "concat", "-safe", "0", "-i", batch]);
      chains.push(`[${bi}:v]format=rgba,fps=${f(fps)},setpts=PTS-STARTPTS[l${layerIdx}]`);
      const next = `base${layerIdx + 1}`;
      chains.push(`[${base}][l${layerIdx}]overlay=0:0:eof_action=pass:format=auto[${next}]`);
      base = next;
      layerIdx++;
      continue;
    }
    const anim = scaleAnim(layer.anim, 1); // anim already in composition px (videoLayers got CW/CH)
    const parts: string[] = [];
    let idx: number;
    let geometry = { x: "0", y: "0" };
    if (isTextClip(clip)) {
      const png = textPaths[clip.id];
      if (!png) throw new Error(`Missing rasterised text for clip ${clip.id}`);
      idx = addInput(["-loop", "1", "-framerate", f(fps), "-t", f(L + 1 / fps), "-i", png]);
      parts.push(`[${idx}:v]format=rgba`, `trim=duration=${f(L)}`, `setpts=PTS-STARTPTS`);
    } else if (isMediaClip(clip) && layer.media) {
      const m = layer.media;
      if (m.kind === "image") {
        idx = addInput(["-loop", "1", "-framerate", f(fps), "-t", f(L + 1 / fps), "-i", m.path]);
        parts.push(`[${idx}:v]trim=duration=${f(L)}`, `setpts=PTS-STARTPTS`);
      } else {
        const srcLen = (L + 2 / fps) * clip.speed;
        idx = addInput(["-ss", f(clip.in), "-t", f(srcLen), "-i", m.path]);
        clipInput[clip.id] = idx;
        parts.push(`[${idx}:v]setpts=(PTS-STARTPTS)/${f(clip.speed)}`, `fps=${f(fps)}`, `tpad=stop_mode=clone:stop_duration=${f(L)}`, `trim=duration=${f(L)}`, `setpts=PTS-STARTPTS`);
      }
      const size = layerPixelSize(p, clip, m.width, m.height, CW, CH, unit);
      const r = mediaRect(m.width, m.height, clip, CW, CH, unit);
      const c = clip.crop;
      const a = assets[clip.id] ?? {};
      const alpha = needsAlpha(layer);
      if (c.left || c.top || c.right || c.bottom) parts.push(`crop=${Math.round(r.sw)}:${Math.round(r.sh)}:${Math.round(r.sx)}:${Math.round(r.sy)}`);
      parts.push(`scale=${size.w}:${size.h}:flags=bicubic`);
      if (a.lut) parts.push(`lut3d=file=${ffPath(a.lut)}:interp=trilinear`);
      parts.push(alpha ? "format=yuva420p" : "format=yuv420p");
      const ck = clip.chromaKey;
      if (ck?.enabled) parts.push(`chromakey=${escapeColor(ck.color)}:${f(Math.max(0.01, ck.similarity), 4)}:${f(Math.max(0, ck.blend), 4)}`);
      for (const e of clip.effects ?? []) {
        if (!e.enabled || e.amount <= 0) continue;
        if (e.type === "blur") parts.push(`gblur=sigma=${f(Math.max(0.1, e.amount * 30 * unit), 3)}`);
        if (e.type === "sharpen") parts.push(`unsharp=5:5:${f(e.amount * 2, 3)}:5:5:0`);
        if (e.type === "grain") parts.push(`noise=c0s=${Math.round(e.amount * 45)}:c0f=t+u`);
        if (e.type === "letterbox") {
          const bar = `ih*${f(Math.min(0.45, e.amount * 0.5), 4)}`;
          parts.push(`drawbox=x=0:y=0:w=iw:h='${bar}':color=black@1:t=fill`, `drawbox=x=0:y='ih-${bar}':w=iw:h='${bar}':color=black@1:t=fill`);
        }
      }
      // inputs that must be composited onto the layer (vignette, mask) split the chain
      const flush = (label: string) => {
        chains.push(`${parts.join(",")}[${label}]`);
        parts.length = 0;
      };
      if (a.vignette) {
        const vi = addInput(["-loop", "1", "-framerate", f(fps), "-t", f(L + 1 / fps), "-i", a.vignette]);
        flush(`pv${layerIdx}`);
        chains.push(`[${vi}:v]format=yuva420p,trim=duration=${f(L)},setpts=PTS-STARTPTS[vg${layerIdx}]`);
        parts.push(`[pv${layerIdx}][vg${layerIdx}]overlay=0:0:format=auto:alpha=straight`, "format=yuva420p");
      }
      if (a.mask) {
        const mi = addInput(["-loop", "1", "-framerate", f(fps), "-t", f(L + 1 / fps), "-i", a.mask]);
        flush(`pm${layerIdx}`);
        chains.push(`[${mi}:v]format=yuva420p,trim=duration=${f(L)},setpts=PTS-STARTPTS[mk${layerIdx}]`);
        parts.push(`[pm${layerIdx}][mk${layerIdx}]blend=c0_mode=normal:c1_mode=normal:c2_mode=normal:c3_mode=multiply`);
      }
      if (clip.transform.flipH) parts.push("hflip");
      if (clip.transform.flipV) parts.push("vflip");
      if (geomKf(clip)) {
        // animated position/scale/rotation: pad into a transparent frame and map its corners per frame
        const PW = Math.max(CW, size.w + 2 * PAD);
        const PH = Math.max(CH, size.h + 2 * PAD);
        const tv = `(in/${f(fps)})`;
        const kf = clip.keyframes!;
        const K = `((${kfExpr(kf.scale, clip.transform.scale, tv)})/${f(size.maxScale)})`;
        const R = `((${kfExpr(kf.rotation, clip.transform.rotation, tv)})*PI/180)`;
        const CX = `(${f(CW / 2)}+(${kfExpr(kf.x, clip.transform.x, tv)})*${f(unit)})`;
        const CY = `(${f(CH / 2)}+(${kfExpr(kf.y, clip.transform.y, tv)})*${f(unit)})`;
        const ox = PAD + size.w / 2;
        const oy = PAD + size.h / 2;
        const corner = (px: number, py: number) => {
          const dx = `(${K}*${f(px - ox)})`;
          const dy = `(${K}*${f(py - oy)})`;
          return [`${CX}+${dx}*cos(${R})-${dy}*sin(${R})`, `${CY}+${dx}*sin(${R})+${dy}*cos(${R})`];
        };
        const [x0, y0] = corner(0, 0);
        const [x1, y1] = corner(PW, 0);
        const [x2, y2] = corner(0, PH);
        const [x3, y3] = corner(PW, PH);
        parts.push(`pad=${PW}:${PH}:${PAD}:${PAD}:color=black@0`);
        parts.push(`perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y1}':x2='${x2}':y2='${y2}':x3='${x3}':y3='${y3}':sense=destination:eval=frame:interpolation=linear`);
        geometry = { x: "0", y: "0" };
      } else {
        const rot = ((clip.transform.rotation % 360) + 360) % 360;
        if (rot) {
          const rad = f((rot * Math.PI) / 180, 8);
          parts.push(`rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`);
        }
        geometry = { x: `${f(r.cx, 3)}-overlay_w/2`, y: `${f(r.cy, 3)}-overlay_h/2` };
      }
    } else continue;
    parts.push(...alphaFilters(layer, isTextClip(clip)));
    parts.push(`setpts=PTS+${f(layer.windowStart)}/TB[l${layerIdx}]`);
    chains.push(parts.join(","));
    const xs = slideExpr(anim, "dx");
    const ys = slideExpr(anim, "dy");
    const x = `${geometry.x}${xs !== "0" ? `+${xs}` : ""}`;
    const y = `${geometry.y}${ys !== "0" ? `+${ys}` : ""}`;
    const next = `base${layerIdx + 1}`;
    chains.push(
      `[${base}][l${layerIdx}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:format=auto:enable='between(t,${f(layer.windowStart)},${f(layer.windowEnd)})'[${next}]`,
    );
    base = next;
    layerIdx++;
  }

  const finalFilters: string[] = [];
  if (CW !== s.width || CH !== s.height) finalFilters.push(`pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2:color=black`);
  finalFilters.push(`format=${pixFmtFor(s)}`);
  chains.push(`[${base}]${finalFilters.join(",")}[vout]`);

  // ----- audio
  if (s.includeAudio) {
    const segs = audioSegments(p);
    const labels: string[] = [];
    segs.forEach((seg, j) => {
      let idx = clipInput[seg.clip.id];
      if (idx === undefined) {
        idx = addInput(["-ss", f(seg.in), "-t", f((seg.duration + 0.1) * seg.speed), "-i", seg.media.path]);
        clipInput[seg.clip.id] = idx;
      }
      const a: string[] = [`[${idx}:a]asetpts=PTS-STARTPTS`, `aformat=sample_fmts=fltp:sample_rates=${s.sampleRate}:channel_layouts=stereo`];
      a.push(...atempoChain(seg.speed));
      a.push(`atrim=duration=${f(seg.duration)}`, `asetpts=PTS-STARTPTS`);
      const fx = seg.clip.audioFx;
      if (fx) {
        if (fx.noiseReduction > 0) a.push(`afftdn=nr=${f(6 + fx.noiseReduction * 30, 2)}:nf=-45`);
        if (fx.eqLow) a.push(`equalizer=f=100:t=q:w=0.7:g=${f(fx.eqLow, 2)}`);
        if (fx.eqMid) a.push(`equalizer=f=1000:t=q:w=1:g=${f(fx.eqMid, 2)}`);
        if (fx.eqHigh) a.push(`equalizer=f=8000:t=q:w=0.7:g=${f(fx.eqHigh, 2)}`);
        if (fx.compressor > 0)
          a.push(`acompressor=threshold=${f(Math.pow(10, (-8 - 22 * fx.compressor) / 20), 5)}:ratio=${f(1 + 7 * fx.compressor, 2)}:attack=10:release=200:makeup=${f(1 + 2 * fx.compressor, 2)}`);
      }
      const volKf = seg.clip.keyframes?.volume;
      const trackGain = seg.clip.volume > 0 ? seg.gain / seg.clip.volume : 0;
      if (volKf?.length) a.push(`volume='(${kfExpr(volKf, seg.clip.volume, "t")})*${f(trackGain, 4)}':eval=frame`);
      else if (Math.abs(seg.gain - 1) > 1e-4) a.push(`volume=${f(seg.gain, 4)}`);
      if (seg.fadeIn > 0) a.push(`afade=t=in:st=0:d=${f(seg.fadeIn)}`);
      if (seg.fadeOut > 0) a.push(`afade=t=out:st=${f(seg.duration - seg.fadeOut)}:d=${f(seg.fadeOut)}`);
      const ms = Math.round(seg.start * 1000);
      if (ms > 0) a.push(`adelay=${ms}:all=1`);
      chains.push(`${a.join(",")}[a${j}]`);
      labels.push(`[a${j}]`);
    });
    if (labels.length) {
      chains.push(
        `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${f(total)},atrim=duration=${f(total)}${masterFx(p)}[aout]`,
      );
    } else {
      chains.push(`anullsrc=r=${s.sampleRate}:cl=stereo,atrim=duration=${f(total)}[aout]`);
    }
  }

  const out: string[] = ["-map", "[vout]"];
  if (s.includeAudio) out.push("-map", "[aout]");
  out.push(...videoCodecArgs(s), "-r", f(fps));
  if (s.includeAudio) out.push(...audioCodecArgs(s));
  else out.push("-an");
  out.push("-t", f(total));
  if (s.container !== "webm") out.push("-movflags", "+faststart");
  out.push("-metadata", `title=${p.name}`, "-f", s.container === "mov" ? "mov" : s.container);

  return { inputArgs: inputs, filterGraph: chains.join(";\n"), outputArgs: out, duration: total, compWidth: CW, compHeight: CH, unit };
}
