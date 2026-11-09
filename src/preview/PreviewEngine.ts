// Real-time preview compositor. A master clock drives pooled decoders
// (HTMLVideoElement / HTMLAudioElement / HTMLImageElement used only as frame/sample
// sources); every frame is composited on a canvas from the shared render resolver.

import { api, fileUrl } from "../backend/api";
import { buildLut, isColorIdentity, parseCube, type Lut3D } from "../engine/color";
import { evalKf } from "../engine/keyframes";
import { drawLetterbox, drawMask, drawVignette } from "../engine/layerFx";
import { GlFilter } from "./GlFilter";
import { audioSegments, evalLayer, layersAt, mediaRect, videoLayers, type AudioSegment, type RenderLayer } from "../engine/segments";
import { drawTextClip } from "../engine/textRender";
import { projectDuration } from "../engine/timelineOps";
import { previewPath } from "../services/media";
import { isMediaClip, isTextClip, type MediaAsset, type MediaClip, type Project } from "../types/project";

const LOOKAHEAD = 1.5;
const EVICT_DISTANCE = 12;

interface Decoder {
  el: HTMLMediaElement;
  src: string;
  lastUsed: number;
}

export class PreviewEngine {
  private ctx: CanvasRenderingContext2D;
  private project: Project | null = null;
  private layers: RenderLayer[] = [];
  private audio: AudioSegment[] = [];
  private duration = 0;
  private videos = new Map<string, Decoder>();
  private audios = new Map<string, Decoder>();
  private images = new Map<string, HTMLImageElement>();
  private host: HTMLDivElement;
  private raf = 0;
  private wallStart = 0;
  private timeStart = 0;
  private renderQueued = false;
  private quality = 1;
  time = 0;
  playing = false;
  /** before/after comparison: draw without colour & effects */
  bypassFx = false;
  private gl?: GlFilter;
  private luts = new Map<string, { key: string; lut: Lut3D }>();
  private userLuts = new Map<string, Lut3D | "loading" | "error">();
  private off = document.createElement("canvas");
  private maskCanvas = document.createElement("canvas");
  private maskKey = "";
  private grain = document.createElement("canvas");
  rate = 1;
  onTime?: (t: number) => void;
  onStop?: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.host = document.createElement("div");
    this.host.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(this.host);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const d of [...this.videos.values(), ...this.audios.values()]) this.release(d);
    this.videos.clear();
    this.audios.clear();
    this.host.remove();
  }

  get unit() {
    return this.project ? this.canvas.width / this.project.settings.width : 1;
  }

  setProject(p: Project | null) {
    if (p === this.project) return;
    const sizeChanged = !this.project || !p || p.settings.width !== this.project.settings.width || p.settings.height !== this.project.settings.height;
    this.project = p;
    this.layers = p ? videoLayers(p) : [];
    this.audio = p ? audioSegments(p) : [];
    this.duration = p ? projectDuration(p) : 0;
    if (sizeChanged) this.applySize();
    this.sync(true);
    this.requestRender();
  }

  setQuality(q: number) {
    this.quality = q;
    this.applySize();
    this.requestRender();
  }

  private applySize() {
    if (!this.project) return;
    const w = Math.max(2, Math.round(this.project.settings.width * this.quality));
    const h = Math.max(2, Math.round(this.project.settings.height * this.quality));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  seek(t: number) {
    this.time = Math.max(0, t);
    if (this.playing) {
      this.timeStart = this.time;
      this.wallStart = performance.now();
    }
    this.sync(true);
    this.requestRender();
  }

  setRate(r: number) {
    if (this.playing) {
      this.timeStart = this.time;
      this.wallStart = performance.now();
    }
    this.rate = r;
  }

  play() {
    if (!this.project || this.playing) return;
    if (this.time >= this.duration - 1e-3) this.time = 0;
    this.playing = true;
    this.timeStart = this.time;
    this.wallStart = performance.now();
    this.sync(true);
    const loop = () => {
      if (!this.playing) return;
      const t = this.timeStart + ((performance.now() - this.wallStart) / 1000) * this.rate;
      if (t >= this.duration) {
        this.time = this.duration;
        this.pause();
        this.onTime?.(this.time);
        this.onStop?.();
        return;
      }
      this.time = t;
      this.sync(false);
      this.render();
      this.onTime?.(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const d of [...this.videos.values(), ...this.audios.values()]) if (!d.el.paused) d.el.pause();
    this.sync(true);
    this.requestRender();
  }

  // ---------------------------------------------------------------- decoders

  private decoder(map: Map<string, Decoder>, key: string, m: MediaAsset, kind: "video" | "audio"): Decoder | null {
    const path = previewPath(m);
    if (!path || m.missing) return null;
    const src = fileUrl(path);
    let d = map.get(key);
    if (d && d.src !== src) {
      this.release(d);
      map.delete(key);
      d = undefined;
    }
    if (!d) {
      const el = document.createElement(kind);
      el.preload = "auto";
      el.crossOrigin = "anonymous"; // loopback media server sends CORS headers → untainted canvas
      el.muted = true;
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.src = src;
      const rerender = () => !this.playing && this.requestRender();
      el.addEventListener("seeked", rerender);
      el.addEventListener("loadeddata", rerender);
      el.addEventListener("error", rerender);
      this.host.appendChild(el);
      d = { el, src, lastUsed: this.time };
      map.set(key, d);
    }
    d.lastUsed = this.time;
    return d;
  }

  private release(d: Decoder) {
    d.el.pause();
    d.el.removeAttribute("src");
    d.el.load();
    d.el.remove();
  }

  private image(m: MediaAsset): HTMLImageElement | null {
    if (m.missing) return null;
    let img = this.images.get(m.id);
    const src = fileUrl(m.path);
    if (!img || img.dataset.src !== src) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.dataset.src = src;
      img.onload = () => this.requestRender();
      img.src = src;
      this.images.set(m.id, img);
    }
    return img;
  }

  private gainAt(seg: AudioSegment, t: number): number {
    if (t < seg.start || t >= seg.start + seg.duration) return 0;
    const trackGain = seg.clip.volume > 0 ? seg.gain / seg.clip.volume : 1;
    let g = evalKf(seg.clip.keyframes?.volume, t - seg.start, seg.clip.volume) * trackGain * (this.project?.master?.volume ?? 1);
    if (seg.fadeIn > 0) g *= Math.min(1, (t - seg.start) / seg.fadeIn);
    if (seg.fadeOut > 0) g *= Math.min(1, (seg.start + seg.duration - t) / seg.fadeOut);
    return Math.max(0, Math.min(1, g));
  }

  private drive(d: Decoder, target: number, speed: number, active: boolean, force: boolean, fps: number) {
    const el = d.el;
    if (el.readyState === 0 && !force) return;
    if (this.playing && active) {
      const desired = Math.min(16, Math.max(0.0625, speed * this.rate));
      if (el.paused) {
        el.currentTime = target;
        el.playbackRate = desired;
        void el.play().catch(() => undefined);
        return;
      }
      const drift = el.currentTime - target;
      if (Math.abs(drift) > 0.3) {
        el.currentTime = target;
        el.playbackRate = desired;
      } else if (Math.abs(drift) > 0.03) {
        el.playbackRate = Math.min(16, Math.max(0.0625, desired * (1 - Math.max(-0.1, Math.min(0.1, drift)))));
      } else if (Math.abs(el.playbackRate - desired) > 1e-3) el.playbackRate = desired;
    } else {
      if (!el.paused) el.pause();
      if ((force || !el.seeking) && Math.abs(el.currentTime - target) > 0.5 / fps) el.currentTime = target;
    }
  }

  /** Bring decoders in line with the clock. */
  private sync(force: boolean) {
    const p = this.project;
    if (!p) return;
    const t = this.time;
    const fps = p.settings.fps;
    const usedVideos = new Set<string>();
    const usedAudios = new Set<string>();
    const audioByClip = new Map(this.audio.map((s) => [s.clip.id, s]));

    for (const layer of this.layers) {
      const c = layer.clip;
      if (!isMediaClip(c) || layer.media?.kind !== "video") continue;
      const active = t >= layer.windowStart && t < layer.windowEnd;
      const upcoming = !active && layer.windowStart > t && layer.windowStart - t < LOOKAHEAD;
      if (!active && !upcoming) continue;
      const d = this.decoder(this.videos, c.id, layer.media, "video");
      if (!d) continue;
      usedVideos.add(c.id);
      const target = active ? evalLayer(layer, t).sourceTime : c.in;
      this.drive(d, target, c.speed, active, force, fps);
      const seg = audioByClip.get(c.id);
      const g = seg && active ? this.gainAt(seg, t) : 0;
      d.el.muted = g <= 0;
      d.el.volume = g;
    }
    // audio that is not carried by a visible video layer
    for (const seg of this.audio) {
      if (usedVideos.has(seg.clip.id)) continue;
      const active = t >= seg.start && t < seg.start + seg.duration;
      const upcoming = !active && seg.start > t && seg.start - t < LOOKAHEAD;
      if (!active && !upcoming) continue;
      const d = this.decoder(this.audios, seg.clip.id, seg.media, "audio");
      if (!d) continue;
      usedAudios.add(seg.clip.id);
      const target = active ? seg.in + (t - seg.start) * seg.speed : seg.in;
      this.drive(d, target, seg.speed, active, force, fps);
      const g = this.gainAt(seg, t);
      d.el.muted = g <= 0;
      d.el.volume = g;
    }
    for (const [map, used] of [
      [this.videos, usedVideos],
      [this.audios, usedAudios],
    ] as const) {
      for (const [k, d] of map) {
        if (used.has(k)) continue;
        if (!d.el.paused) d.el.pause();
        if (Math.abs(d.lastUsed - t) > EVICT_DISTANCE || !this.project?.clips[k]) {
          this.release(d);
          map.delete(k);
        }
      }
    }
  }

  // ---------------------------------------------------------------- drawing

  requestRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.playing) this.render();
    });
  }

  render() {
    const p = this.project;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p?.settings.background ?? "#000";
    ctx.fillRect(0, 0, W, H);
    if (!p) {
      ctx.restore();
      return;
    }
    const unit = this.unit;
    const t = this.time;
    for (const layer of layersAt(this.layers, t)) {
      const st = evalLayer(layer, t);
      if (st.alpha <= 0.001) continue;
      const c = layer.clip;
      if (isTextClip(c)) {
        drawTextClip(ctx, c, W, H, unit, st.alpha, st.dx * unit, st.dy * unit);
        continue;
      }
      if (!isMediaClip(c) || !layer.media) continue;
      const m = layer.media;
      const r = mediaRect(m.width || 16, m.height || 9, c, W, H, unit, { x: st.x, y: st.y, scale: st.scale });
      let src: CanvasImageSource | null = null;
      let sw = 0;
      let sh = 0;
      if (m.kind === "image") {
        const img = this.image(m);
        if (img && img.complete && img.naturalWidth) {
          src = img;
          sw = img.naturalWidth;
          sh = img.naturalHeight;
        }
      } else {
        const d = this.videos.get(c.id);
        const v = d?.el as HTMLVideoElement | undefined;
        if (v && v.readyState >= 2 && v.videoWidth) {
          src = v;
          sw = v.videoWidth;
          sh = v.videoHeight;
        }
      }
      ctx.save();
      ctx.globalAlpha = st.alpha;
      ctx.translate(r.cx + st.dx * unit, r.cy + st.dy * unit);
      ctx.rotate((st.rotation * Math.PI) / 180);
      ctx.scale(c.transform.flipH ? -1 : 1, c.transform.flipV ? -1 : 1);
      if (src) {
        const cr = c.crop;
        ctx.imageSmoothingQuality = "high";
        const processed = !this.bypassFx && this.hasFx(c) ? this.processLayer(c, src, sw, sh, r.w, r.h) : null;
        if (processed) ctx.drawImage(processed, -r.w / 2, -r.h / 2, r.w, r.h);
        else ctx.drawImage(src, sw * cr.left, sh * cr.top, sw * (1 - cr.left - cr.right), sh * (1 - cr.top - cr.bottom), -r.w / 2, -r.h / 2, r.w, r.h);
      } else {
        // decoder not ready, proxy pending or file missing
        ctx.fillStyle = m.missing ? "#3b0d12" : "#111827";
        ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
        ctx.fillStyle = m.missing ? "#fca5a5" : "#9ca3af";
        ctx.font = `${Math.max(12, 28 * unit)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.scale(c.transform.flipH ? -1 : 1, c.transform.flipV ? -1 : 1);
        ctx.fillText(m.missing ? `⚠ ${m.name}` : m.proxyState === "pending" ? "Generating proxy…" : "Loading…", 0, 0);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /** Canvas-space rect of a clip at the current time (for on-canvas manipulation). */
  clipBox(clipId: string): { cx: number; cy: number; w: number; h: number; rotation: number } | null {
    const p = this.project;
    if (!p) return null;
    const layer = layersAt(this.layers, this.time).find((l) => l.clip.id === clipId);
    if (!layer || !isMediaClip(layer.clip) || !layer.media) return null;
    const unit = this.unit;
    const st = evalLayer(layer, this.time);
    const r = mediaRect(layer.media.width || 16, layer.media.height || 9, layer.clip, this.canvas.width, this.canvas.height, unit, { x: st.x, y: st.y, scale: st.scale });
    return { cx: r.cx + st.dx * unit, cy: r.cy + st.dy * unit, w: r.w, h: r.h, rotation: st.rotation };
  }

  // ---------------------------------------------------------------- colour & effects

  private hasFx(c: MediaClip): boolean {
    return !isColorIdentity(c.color) || !!c.chromaKey?.enabled || !!c.mask || !!c.effects?.some((e) => e.enabled && e.amount > 0);
  }

  private userLut(path: string): Lut3D | null {
    const v = this.userLuts.get(path);
    if (v === undefined) {
      this.userLuts.set(path, "loading");
      api
        .readTextFile(path)
        .then((txt) => this.userLuts.set(path, parseCube(txt)))
        .catch(() => this.userLuts.set(path, "error"))
        .finally(() => this.requestRender());
      return null;
    }
    return typeof v === "string" ? null : v;
  }

  private lutFor(c: MediaClip): { key: string; lut: Lut3D } | null {
    if (isColorIdentity(c.color)) return null;
    const user = c.color!.lutPath ? this.userLut(c.color!.lutPath) : null;
    const key = JSON.stringify(c.color) + (user ? ":u" : "");
    let e = this.luts.get(c.id);
    if (!e || e.key !== key) {
      e = { key, lut: buildLut(c.color!, user) };
      this.luts.set(c.id, e);
    }
    return e;
  }

  private processLayer(c: MediaClip, src: CanvasImageSource, sw: number, sh: number, w: number, h: number): HTMLCanvasElement | null {
    const W = Math.max(1, Math.min(4096, Math.round(w)));
    const H = Math.max(1, Math.min(4096, Math.round(h)));
    const cr = c.crop;
    const crop = { x: sw * cr.left, y: sh * cr.top, w: sw * (1 - cr.left - cr.right), h: sh * (1 - cr.top - cr.bottom) };
    const fx = (t: string) => c.effects?.find((e) => e.enabled && e.type === t && e.amount > 0)?.amount ?? 0;
    const lut = this.lutFor(c);
    const key = c.chromaKey?.enabled ? c.chromaKey : null;
    const sharpen = fx("sharpen") * 1.5;
    let base: CanvasImageSource | null = null;
    if (lut || key || sharpen) {
      this.gl ??= new GlFilter();
      base = this.gl.process(src as TexImageSource, sw, sh, crop, W, H, { lut, key, sharpen });
    }
    if (this.off.width !== W || this.off.height !== H) {
      this.off.width = W;
      this.off.height = H;
    }
    const ctx = this.off.getContext("2d")!;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    const blur = fx("blur");
    if (blur && "filter" in ctx) ctx.filter = `blur(${blur * 30 * this.unit}px)`;
    if (base) ctx.drawImage(base, 0, 0, W, H);
    else ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
    ctx.filter = "none";
    const lb = fx("letterbox");
    if (lb) drawLetterbox(ctx, W, H, lb);
    const grain = fx("grain");
    if (grain) {
      if (this.grain.width !== 128) {
        this.grain.width = 128;
        this.grain.height = 128;
      }
      const g = this.grain.getContext("2d")!;
      const img = g.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = grain * 0.35;
      ctx.fillStyle = ctx.createPattern(this.grain, "repeat")!;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    const vig = fx("vignette");
    if (vig) {
      ctx.globalCompositeOperation = "source-atop";
      drawVignette(ctx, W, H, vig);
      ctx.globalCompositeOperation = "source-over";
    }
    if (c.mask) {
      const mk = `${W}x${H}:${JSON.stringify(c.mask)}`;
      if (mk !== this.maskKey) {
        this.maskCanvas.width = W;
        this.maskCanvas.height = H;
        drawMask(this.maskCanvas.getContext("2d")!, W, H, c.mask);
        this.maskKey = mk;
      }
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(this.maskCanvas, 0, 0);
    }
    ctx.restore();
    return this.off;
  }

  private scratch?: CanvasRenderingContext2D;

  /** Canvas-space box of a text clip at the current time. */
  textBox(clipId: string): { x: number; y: number; w: number; h: number } | null {
    const layer = layersAt(this.layers, this.time).find((l) => l.clip.id === clipId);
    if (!layer || !isTextClip(layer.clip)) return null;
    if (!this.scratch) this.scratch = document.createElement("canvas").getContext("2d")!;
    const st = evalLayer(layer, this.time);
    const unit = this.unit;
    return drawTextClip(this.scratch, layer.clip, this.canvas.width, this.canvas.height, unit, 0, st.dx * unit, st.dy * unit);
  }

  canvasElement() {
    return this.canvas;
  }
}
