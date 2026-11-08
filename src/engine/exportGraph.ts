// Builds the FFmpeg command (inputs, filter graph, outputs) for a project.
// Pure function — unit tested in tests/exportGraph.test.ts and executed with a
// real FFmpeg in scripts/e2e-export.mjs.

import { isMediaClip, isTextClip, type Project } from "../types/project";
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
  return videoLayers(p)
    .filter((l) => isTextClip(l.clip))
    .map((l) => l.clip.id);
}

export const textFileName = (clipId: string) => `text_${clipId}.png`;

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

function alphaFilters(layer: RenderLayer): string[] {
  const out: string[] = [];
  const op = layer.clip.opacity;
  if (op < 0.999) out.push(`colorchannelmixer=aa=${f(Math.max(0, op), 4)}`);
  const ws = layer.windowStart;
  if (layer.anim.fadeIn) out.push(`fade=t=in:st=${f(layer.anim.fadeIn.start - ws)}:d=${f(layer.anim.fadeIn.dur)}:alpha=1`);
  if (layer.anim.fadeOut) out.push(`fade=t=out:st=${f(layer.anim.fadeOut.start - ws)}:d=${f(layer.anim.fadeOut.dur)}:alpha=1`);
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
export function buildExport(p: Project, s: ExportSettings, textPaths: Record<string, string>): ExportPlan {
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

  for (const layer of videoLayers(p, CW, CH)) {
    const clip = layer.clip;
    const L = layer.windowEnd - layer.windowStart;
    if (L <= 0) continue;
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
      const r = mediaRect(m.width, m.height, clip, CW, CH, unit);
      const c = clip.crop;
      if (c.left || c.top || c.right || c.bottom) parts.push(`crop=${Math.round(r.sw)}:${Math.round(r.sh)}:${Math.round(r.sx)}:${Math.round(r.sy)}`);
      parts.push(`scale=${Math.max(1, Math.round(r.w))}:${Math.max(1, Math.round(r.h))}:flags=bicubic`, "format=rgba");
      if (clip.transform.flipH) parts.push("hflip");
      if (clip.transform.flipV) parts.push("vflip");
      const rot = ((clip.transform.rotation % 360) + 360) % 360;
      if (rot) {
        const rad = f((rot * Math.PI) / 180, 8);
        parts.push(`rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`);
      }
      geometry = { x: `${f(r.cx, 3)}-overlay_w/2`, y: `${f(r.cy, 3)}-overlay_h/2` };
    } else continue;
    parts.push(...alphaFilters(layer));
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
      if (Math.abs(seg.gain - 1) > 1e-4) a.push(`volume=${f(seg.gain, 4)}`);
      if (seg.fadeIn > 0) a.push(`afade=t=in:st=0:d=${f(seg.fadeIn)}`);
      if (seg.fadeOut > 0) a.push(`afade=t=out:st=${f(seg.duration - seg.fadeOut)}:d=${f(seg.fadeOut)}`);
      const ms = Math.round(seg.start * 1000);
      if (ms > 0) a.push(`adelay=${ms}:all=1`);
      chains.push(`${a.join(",")}[a${j}]`);
      labels.push(`[a${j}]`);
    });
    if (labels.length) {
      chains.push(
        `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${f(total)},atrim=duration=${f(total)}[aout]`,
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
