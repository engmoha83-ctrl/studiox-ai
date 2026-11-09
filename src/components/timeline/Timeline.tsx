import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { produce } from "immer";
import {
  AudioLines, ClipboardPaste, Copy, Eye, EyeOff, Film, Lock, Magnet, Maximize2, Pencil, Plus, Scissors, SquareSplitHorizontal,
  Trash2, Type, Unlink, Unlock, Volume2, VolumeX, ZoomIn, ZoomOut, ArrowUp, ArrowDown, Gauge, ArrowRightLeft,
} from "lucide-react";
import * as ops from "../../engine/timelineOps";
import { snapFrame, shortTime } from "../../lib/time";
import { fileUrl } from "../../backend/api";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { useUi, MAX_ZOOM, MIN_ZOOM } from "../../store/uiStore";
import { player } from "../../preview/player";
import * as A from "../../editor/actions";
import { ensureFilmstrip, ensureWaveform } from "../../services/media";
import { registerDropResolver, useDrag } from "../../editor/dragdrop";
import { isMediaClip, isTextClip, type Clip, type MediaAsset, type Project, type Track, type TransitionType } from "../../types/project";

registerDropResolver((x, y) => timelineDropTarget(x, y));
import { IconBtn, cx, openContextMenu, promptText, confirmAction } from "../common/ui";

const RULER_H = 26;
const HEADER_W = 200;
const EDGE_PX = 7;
const SNAP_PX = 9;
export const trackHeight = (t: Track) => (t.kind === "video" ? 66 : t.kind === "audio" ? 54 : 36);

// ---------------------------------------------------------------- layout registry (OS drop hit-testing)
const layout = { el: null as HTMLDivElement | null, rows: [] as { id: string; top: number; height: number }[], zoom: 60 };

export function timelineDropTarget(clientX: number, clientY: number): { time: number; trackId: string } | null {
  const el = layout.el;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top + RULER_H || clientY > r.bottom) return null;
  const x = clientX - r.left + el.scrollLeft;
  const y = clientY - r.top + el.scrollTop - RULER_H;
  const row = layout.rows.find((rw) => y >= rw.top && y < rw.top + rw.height);
  if (!row) return null;
  return { time: Math.max(0, x / layout.zoom), trackId: row.id };
}
export function timelineWidth() {
  return layout.el?.clientWidth ?? 1000;
}

// ---------------------------------------------------------------- drag state

type DragMode = "move" | "trim-start" | "trim-end";
interface DragState {
  mode: DragMode;
  ids: string[];
  primary: string;
  x0: number;
  y0: number;
  started: boolean;
  orig: Record<string, { start: number; trackId: string; duration: number }>;
  preview?: Project;
  snapAt?: number;
  final?: { moves?: ops.ClipMove[]; trimTime?: number };
}

// ---------------------------------------------------------------- clip visuals

function Filmstrip({ clip, media, width, visible }: { clip: Clip & { type: "media" }; media: MediaAsset; width: number; visible: [number, number] }) {
  const strip = useApp((s) => s.filmstrips[media.id]);
  useEffect(() => void ensureFilmstrip(media), [media]);
  if (media.kind === "image") {
    return media.thumbnail ? <div className="absolute inset-0 opacity-70" style={{ backgroundImage: `url("${fileUrl(media.thumbnail)}")`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} /> : null;
  }
  if (!strip || typeof strip === "string") return null;
  const h = 44;
  const tw = (strip.tileWidth / strip.tileHeight) * h;
  const zoom = width / clip.duration;
  const first = Math.max(0, Math.floor(visible[0] / tw));
  const last = Math.min(Math.ceil(width / tw), Math.ceil(visible[1] / tw));
  const tiles = [];
  for (let i = first; i < last && tiles.length < 200; i++) {
    const tl = (i * tw) / zoom; // timeline seconds into clip
    const src = clip.in + tl * clip.speed;
    const idx = Math.min(strip.count - 1, Math.max(0, Math.floor(src / strip.interval)));
    tiles.push(
      <div
        key={i}
        className="absolute top-0"
        style={{
          left: i * tw,
          width: tw,
          height: h,
          backgroundImage: `url("${fileUrl(strip.path)}")`,
          backgroundSize: `${strip.count * tw}px ${h}px`,
          backgroundPosition: `${-idx * tw}px 0`,
        }}
      />,
    );
  }
  return <div className="absolute inset-x-0 top-[18px] h-[44px] overflow-hidden opacity-80">{tiles}</div>;
}

function WaveformView({ clip, media, width, height, visible, color }: { clip: Clip & { type: "media" }; media: MediaAsset; width: number; height: number; visible: [number, number]; color: string }) {
  const wave = useApp((s) => s.waveforms[media.id]);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => void ensureWaveform(media), [media]);
  const x0 = Math.max(0, Math.floor(visible[0]));
  const x1 = Math.min(width, Math.ceil(visible[1]));
  const w = Math.max(1, x1 - x0);
  useEffect(() => {
    const c = ref.current;
    if (!c || !wave || typeof wave === "string") return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.min(16000, Math.round(w * dpr));
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = color;
    const zoom = width / clip.duration;
    const mid = height / 2;
    const gain = Math.min(2, clip.volume);
    for (let px = 0; px < w; px++) {
      const tA = clip.in + ((x0 + px) / zoom) * clip.speed;
      const tB = clip.in + ((x0 + px + 1) / zoom) * clip.speed;
      const a = Math.floor(tA * wave.peaksPerSecond);
      const b = Math.max(a + 1, Math.floor(tB * wave.peaksPerSecond));
      let m = 0;
      for (let i = a; i < b && i < wave.peaks.length; i++) m = Math.max(m, wave.peaks[i]);
      const amp = Math.min(1, (m / 255) * gain) * (mid - 1);
      ctx.fillRect(px, mid - amp, 1, Math.max(1, amp * 2));
    }
  }, [wave, w, x0, height, width, clip.in, clip.speed, clip.duration, clip.volume, color]);
  if (!wave || typeof wave === "string") return null;
  return <canvas ref={ref} className="pointer-events-none absolute bottom-0" style={{ left: x0, width: w, height }} />;
}

const TransitionMark = ({ side, type, width }: { side: "in" | "out"; type: TransitionType; width: number }) => (
  <div
    className={cx("pointer-events-none absolute top-0 h-full bg-gradient-to-r", side === "in" ? "left-0 from-white/35 to-transparent" : "right-0 from-transparent to-white/35")}
    style={{ width: Math.max(6, width) }}
    title={type}
  >
    <ArrowRightLeft size={10} className={cx("absolute top-1 text-white/90", side === "in" ? "left-1" : "right-1")} />
  </div>
);

const ClipView = memo(function ClipView({
  clip,
  media,
  track,
  zoom,
  selected,
  ghost,
  viewLeft,
  viewWidth,
  onDown,
  onMenu,
  dropEdge,
}: {
  clip: Clip;
  media?: MediaAsset;
  track: Track;
  zoom: number;
  selected: boolean;
  ghost?: boolean;
  viewLeft: number;
  viewWidth: number;
  onDown: (e: React.PointerEvent, c: Clip) => void;
  onMenu: (e: React.MouseEvent, c: Clip) => void;
  dropEdge?: "in" | "out";
}) {
  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  const h = trackHeight(track) - 6;
  const visible: [number, number] = [viewLeft - left - 50, viewLeft + viewWidth - left + 50];
  const kind = isTextClip(clip) ? "text" : media?.kind ?? "video";
  const bg = kind === "text" ? "bg-tl-text" : kind === "audio" || track.kind === "audio" ? "bg-tl-audio" : kind === "image" ? "bg-tl-image" : "bg-tl-video";
  return (
    <div
      data-clip={clip.id}
      onPointerDown={(e) => onDown(e, clip)}
      onContextMenu={(e) => onMenu(e, clip)}
      className={cx(
        "absolute top-[3px] overflow-hidden rounded-[5px] border text-[11px]",
        bg,
        selected ? "border-white ring-1 ring-white/70 z-10" : "border-black/40",
        ghost && "opacity-80",
        track.locked ? "cursor-not-allowed" : "cursor-grab",
        track.hidden && "opacity-40",
      )}
      style={{ left, width, height: h }}
    >
      {isMediaClip(clip) && media && kind !== "audio" && track.kind !== "audio" && <Filmstrip clip={clip} media={media} width={width} visible={visible} />}
      {isMediaClip(clip) && media?.hasAudio && media.kind !== "image" && (track.kind === "audio" || kind === "audio") && (
        <WaveformView clip={clip} media={media} width={width} height={h - 18} visible={visible} color="rgba(167,243,208,.85)" />
      )}
      {isMediaClip(clip) && media?.hasAudio && media.kind === "video" && track.kind === "video" && !clip.muted && (
        <WaveformView clip={clip} media={media} width={width} height={10} visible={visible} color="rgba(255,255,255,.55)" />
      )}
      <div className="relative z-[1] flex h-[18px] items-center gap-1 bg-black/25 px-1.5 text-white/95">
        {kind === "text" ? <Type size={11} /> : kind === "audio" ? <AudioLines size={11} /> : <Film size={11} />}
        <span className="truncate" dir="auto">
          {isTextClip(clip) ? clip.text.split("\n")[0] : clip.name ?? media?.name}
        </span>
        {isMediaClip(clip) && clip.speed !== 1 && <span className="rounded bg-black/40 px-1 text-[10px]">{+clip.speed.toFixed(2)}×</span>}
        {isMediaClip(clip) && clip.muted && media?.hasAudio && <VolumeX size={11} className="shrink-0 opacity-80" />}
        {media?.missing && <span className="rounded bg-red-600 px-1 text-[9.5px]">!</span>}
      </div>
      {isTextClip(clip) && <div className="absolute inset-0 top-[18px]" />}
      {isMediaClip(clip) && clip.keyframes && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0.5 z-[2] h-2">
          {[...new Set(Object.values(clip.keyframes).flatMap((l) => (l ?? []).map((k) => +k.t.toFixed(3))))].map((kt) => (
            <span key={kt} className="absolute size-1.5 -translate-x-1/2 rotate-45 bg-amber-300" style={{ left: kt * zoom }} />
          ))}
        </div>
      )}
      {clip.transitionIn && <TransitionMark side="in" type={clip.transitionIn.type} width={clip.transitionIn.duration * zoom} />}
      {clip.transitionOut && <TransitionMark side="out" type={clip.transitionOut.type} width={clip.transitionOut.duration * zoom} />}
      {dropEdge && <div className={cx("pointer-events-none absolute inset-y-0 z-[3] w-1/2 bg-violet-400/35", dropEdge === "in" ? "left-0" : "right-0")} />}
      {!track.locked && (
        <>
          <div className="absolute inset-y-0 left-0 z-[2] w-[6px] cursor-ew-resize hover:bg-white/40" />
          <div className="absolute inset-y-0 right-0 z-[2] w-[6px] cursor-ew-resize hover:bg-white/40" />
        </>
      )}
    </div>
  );
});

// ---------------------------------------------------------------- ruler & playhead

function Ruler({ zoom, width, scrollLeft, viewWidth, onScrub }: { zoom: number; width: number; scrollLeft: number; viewWidth: number; onScrub: (e: React.PointerEvent) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fps = useProject((s) => s.project!.settings.fps);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(viewWidth * dpr);
    c.height = RULER_H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, viewWidth, RULER_H);
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800];
    const major = steps.find((s) => s * zoom >= 80) ?? 28800;
    const minor = major / (major >= 1 ? 5 : 2);
    ctx.font = "10px Inter, sans-serif";
    ctx.textBaseline = "top";
    const i0 = Math.floor(scrollLeft / zoom / minor);
    for (let i = i0; i * minor * zoom - scrollLeft < viewWidth; i++) {
      const t = Math.round(i * minor * 1e6) / 1e6; // integer stepping: no float drift in labels
      const x = Math.round(t * zoom - scrollLeft) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.strokeStyle = isMajor ? "#4b5568" : "#2b3243";
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 12 : 18);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = "#8b93a7";
        const label = major < 1 ? `${shortTime(t)}:${String(Math.round((t % 1) * fps)).padStart(2, "0")}` : shortTime(t);
        ctx.fillText(label, x + 3, 2);
      }
    }
  }, [zoom, scrollLeft, viewWidth, fps]);
  return (
    <div className="sticky top-0 z-30 h-[26px] cursor-text border-b border-line bg-panel" style={{ width }} onPointerDown={onScrub}>
      <canvas ref={ref} className="sticky left-0 block" style={{ width: viewWidth, height: RULER_H }} />
    </div>
  );
}

function Playhead({ zoom, height }: { zoom: number; height: number }) {
  const t = useUi((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute top-0 z-40" style={{ left: t * zoom, height }}>
      <div className="absolute -left-[6px] top-0 h-0 w-0 border-x-[6px] border-t-[9px] border-x-transparent border-t-rose-400" />
      <div className="absolute left-0 top-0 h-full w-px bg-rose-400" />
    </div>
  );
}

// ---------------------------------------------------------------- track header

function TrackHeader({ track, height, index, count }: { track: Track; height: number; index: number; count: number }) {
  const { t } = useTranslation();
  const commit = useProject((s) => s.commit);
  const upd = (label: string, f: (tr: Track) => void) =>
    commit(label, (d) => {
      const tr = d.tracks.find((x) => x.id === track.id);
      if (tr) f(tr);
    });
  const Icon = track.kind === "video" ? Film : track.kind === "audio" ? AudioLines : Type;
  const rename = async () => {
    const n = await promptText(t("Rename track"), track.name);
    if (n) upd(t("Rename track"), (tr) => void (tr.name = n));
  };
  const menu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      { label: t("Rename"), icon: <Pencil size={14} />, onClick: rename },
      { label: t("Add video track"), icon: <Film size={14} />, onClick: () => commit(t("Add track"), (d) => void ops.addTrack(d, "video")) },
      { label: t("Add audio track"), icon: <AudioLines size={14} />, onClick: () => commit(t("Add track"), (d) => void ops.addTrack(d, "audio")) },
      { label: t("Add text track"), icon: <Type size={14} />, onClick: () => commit(t("Add track"), (d) => void ops.addTrack(d, "text")) },
      ...(track.kind !== "text"
        ? [
            {
              label: `${t("Track volume")}… (${Math.round(track.volume * 100)}%)`,
              icon: <Volume2 size={14} />,
              onClick: async () => {
                const v = await promptText(t("Track volume (0–200 %)"), String(Math.round(track.volume * 100)));
                const n = v === null ? NaN : parseFloat(v);
                if (!Number.isNaN(n)) upd(t("Track volume"), (tr) => void (tr.volume = Math.min(2, Math.max(0, n / 100))));
              },
            },
          ]
        : []),
      { label: t("Move up"), icon: <ArrowUp size={14} />, disabled: index === 0, onClick: () => commit(t("Move track"), (d) => void d.tracks.splice(index - 1, 0, d.tracks.splice(index, 1)[0])) },
      { label: t("Move down"), icon: <ArrowDown size={14} />, disabled: index === count - 1, onClick: () => commit(t("Move track"), (d) => void d.tracks.splice(index + 1, 0, d.tracks.splice(index, 1)[0])) },
      { separator: true },
      {
        label: t("Delete track"),
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: async () => {
          const n = Object.values(useProject.getState().project!.clips).filter((c) => c.trackId === track.id).length;
          if (!n || (await confirmAction(t("Delete track"), t("Delete track “{{name}}” and its {{n}} clip(s)?", { name: track.name, n }), true))) commit(t("Delete track"), (d) => ops.removeTrack(d, track.id));
        },
      },
    ]);
  return (
    <div onContextMenu={menu} title={track.kind !== "text" ? `${t("Track volume")}: ${Math.round(track.volume * 100)}%` : undefined} className={cx("relative flex items-center gap-1 border-b border-line bg-panel px-2", track.locked && "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,.025)_6px_12px)]")} style={{ height }}>
      <Icon size={13} className={cx("shrink-0", track.kind === "video" ? "text-indigo-300" : track.kind === "audio" ? "text-emerald-300" : "text-fuchsia-300")} />
      <button className="min-w-0 flex-1 truncate text-start text-[12px] font-medium" onDoubleClick={rename} title={track.name}>
        {track.name}
      </button>
      <IconBtn tip={track.locked ? t("Unlock track") : t("Lock track")} active={track.locked} onClick={() => upd(t("Lock track"), (tr) => void (tr.locked = !tr.locked))} className="size-6">
        {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
      </IconBtn>
      {track.kind !== "audio" && (
        <IconBtn tip={track.hidden ? t("Show track") : t("Hide track")} active={track.hidden} onClick={() => upd(t("Hide track"), (tr) => void (tr.hidden = !tr.hidden))} className="size-6">
          {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconBtn>
      )}
      {track.kind !== "text" && (
        <IconBtn tip={t("Solo")} active={!!track.solo} onClick={() => upd(t("Solo"), (tr) => void (tr.solo = !tr.solo))} className="size-6">
          <span className="text-[10px] font-bold">S</span>
        </IconBtn>
      )}
      {track.kind !== "text" && (
        <IconBtn tip={track.muted ? t("Unmute track") : t("Mute track")} active={track.muted} onClick={() => upd(t("Mute track"), (tr) => void (tr.muted = !tr.muted))} className="size-6">
          {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </IconBtn>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- main component

export default function Timeline() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const zoom = useUi((s) => s.zoom);
  const selection = useUi((s) => s.selection);
  const snapping = useUi((s) => s.snapping);
  const ripple = useUi((s) => s.ripple);
  const playing = useUi((s) => s.playing);
  const setUi = useUi((s) => s.set);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dropHint = useDrag((s) => s.hint);
  const clipHint = useDrag((s) => s.clipHint);

  const shown = drag?.preview ?? project;
  const rows = useMemo(() => {
    let top = 0;
    return shown.tracks.map((tr) => {
      const r = { id: tr.id, top, height: trackHeight(tr) };
      top += r.height;
      return r;
    });
  }, [shown.tracks]);
  const totalH = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;
  const duration = ops.projectDuration(project);
  const contentW = Math.max(view.width, (duration + 30) * zoom);
  layout.el = scrollRef.current;
  layout.rows = rows;
  layout.zoom = zoom;

  // Fit the whole edit when the first clips land on an empty timeline.
  const prevDuration = useRef(duration);
  useEffect(() => {
    if (prevDuration.current === 0 && duration > 0 && !drag) A.zoomToFit(scrollRef.current?.clientWidth ?? 1000);
    prevDuration.current = duration;
  }, [duration, drag]);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setView({ left: el.scrollLeft, width: el.clientWidth }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the playhead visible while playing
  useEffect(() => {
    if (!playing) return;
    return useUi.subscribe((s) => {
      const el = scrollRef.current;
      if (!el) return;
      const x = s.playhead * s.zoom;
      if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
    });
  }, [playing]);

  const onScroll = () => {
    const el = scrollRef.current!;
    if (headRef.current) headRef.current.scrollTop = el.scrollTop;
    setView({ left: el.scrollLeft, width: el.clientWidth });
  };

  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current!;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const tAt = (el.scrollLeft + mx) / zoom;
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      useUi.getState().setZoom(nz);
      requestAnimationFrame(() => (el.scrollLeft = Math.max(0, tAt * nz - mx)));
    } else if (e.shiftKey) {
      el.scrollLeft += e.deltaY;
    }
  };
  // ctrl+wheel must be non-passive to prevent page zoom
  useEffect(() => {
    const el = scrollRef.current!;
    const h = (e: WheelEvent) => (e.ctrlKey || e.metaKey) && e.preventDefault();
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / zoom);
  };
  const rowAt = (clientY: number) => {
    const el = scrollRef.current!;
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop - RULER_H;
    return rows.findIndex((r) => y >= r.top && y < r.top + r.height);
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    player.pause();
    player.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => player.seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ------------------------------------------------------------ clip dragging
  const onClipDown = useCallback(
    (e: React.PointerEvent, c: Clip) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const p = useProject.getState().project!;
      const ui = useUi.getState();
      let sel = ui.selection;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        ui.toggleSelect(c.id);
        return;
      }
      if (!sel.includes(c.id)) {
        sel = [c.id];
        ui.select(sel);
      }
      const track = p.tracks.find((x) => x.id === c.trackId);
      if (track?.locked) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ox = e.clientX - r.left;
      const mode: DragMode = ox <= EDGE_PX ? "trim-start" : ox >= r.width - EDGE_PX ? "trim-end" : "move";
      const ids = mode === "move" ? sel.filter((id) => p.clips[id] && !p.tracks.find((x) => x.id === p.clips[id].trackId)?.locked) : [c.id];
      const orig: DragState["orig"] = {};
      for (const id of ids) orig[id] = { start: p.clips[id].start, trackId: p.clips[id].trackId, duration: p.clips[id].duration };
      const st: DragState = { mode, ids, primary: c.id, x0: e.clientX, y0: e.clientY, started: false, orig };
      dragRef.current = st;

      const move = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        if (!d.started && Math.abs(ev.clientX - d.x0) < 3 && Math.abs(ev.clientY - d.y0) < 3) return;
        d.started = true;
        const proj = useProject.getState().project!;
        const z = useUi.getState().zoom;
        const fps = proj.settings.fps;
        const dt = (ev.clientX - d.x0) / z;
        const exclude = new Set(d.ids);
        const points = useUi.getState().snapping ? ops.snapPoints(proj, exclude, useUi.getState().playhead) : [];
        const thr = SNAP_PX / z;
        const po = d.orig[d.primary];
        let snapAt: number | undefined;
        if (d.mode === "move") {
          let ns = po.start + dt;
          const s = ops.snapTime(ns, [0, po.duration], points, thr);
          if (s.snapped) {
            ns = s.time;
            snapAt = s.point;
          }
          const delta = snapFrame(Math.max(ns, 0) - po.start, fps);
          const minStart = Math.min(...d.ids.map((id) => d.orig[id].start));
          const safeDelta = Math.max(delta, -minStart);
          const hover = rowAt(ev.clientY);
          const fromIdx = proj.tracks.findIndex((x) => x.id === po.trackId);
          const rowDelta = hover >= 0 ? hover - fromIdx : 0;
          const moves = d.ids.map((id) => {
            const o = d.orig[id];
            const idx = proj.tracks.findIndex((x) => x.id === o.trackId);
            const target = proj.tracks[idx + rowDelta];
            const ok = target && !target.locked && ops.compatible(proj, proj.clips[id], target);
            return { id, start: o.start + safeDelta, trackId: ok ? target.id : o.trackId };
          });
          d.final = { moves };
          d.preview = produce(proj, (dr) => ops.moveClips(dr, moves));
        } else {
          const edgeT = d.mode === "trim-start" ? po.start + dt : po.start + po.duration + dt;
          const s = ops.snapTime(edgeT, [0], points, thr);
          const tt = s.snapped ? s.time : edgeT;
          snapAt = s.snapped ? s.point : undefined;
          d.final = { trimTime: tt };
          const rip = useUi.getState().ripple;
          d.preview = produce(proj, (dr) => ops.trimClip(dr, d.primary, d.mode === "trim-start" ? "start" : "end", tt, rip));
        }
        d.snapAt = snapAt;
        setDrag({ ...d });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const d = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!d) return;
        if (!d.started) {
          // plain click on a clip also moves the playhead there
          return;
        }
        const { commit } = useProject.getState();
        if (d.mode === "move" && d.final?.moves) commit(t("Move clip"), (dr) => ops.moveClips(dr, d.final!.moves!));
        else if (d.final?.trimTime !== undefined) {
          const rip = useUi.getState().ripple;
          commit(t("Trim clip"), (dr) => ops.trimClip(dr, d.primary, d.mode === "trim-start" ? "start" : "end", d.final!.trimTime!, rip));
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, t],
  );

  const onClipMenu = useCallback(
    (e: React.MouseEvent, c: Clip) => {
      const ui = useUi.getState();
      if (!ui.selection.includes(c.id)) ui.select([c.id]);
      const p = useProject.getState().project!;
      const m = isMediaClip(c) ? p.media.find((x) => x.id === c.mediaId) : undefined;
      openContextMenu(e, [
        { label: t("Split at playhead"), icon: <Scissors size={14} />, shortcut: "S", onClick: A.splitAtPlayhead },
        { label: t("Copy"), icon: <Copy size={14} />, shortcut: "Ctrl+C", onClick: () => A.copySelection() },
        { label: t("Cut"), icon: <Scissors size={14} />, shortcut: "Ctrl+X", onClick: () => A.copySelection(true) },
        { label: t("Paste at playhead"), icon: <ClipboardPaste size={14} />, shortcut: "Ctrl+V", disabled: !ui.clipboard.length, onClick: A.paste },
        { label: t("Duplicate"), icon: <Copy size={14} />, shortcut: "Ctrl+D", onClick: A.duplicateSelection },
        { separator: true },
        ...(m && m.kind === "video" && m.hasAudio ? [{ label: t("Detach audio"), icon: <Unlink size={14} />, onClick: A.detachAudioSelected }] : []),
        ...(isMediaClip(c) && m?.kind !== "image"
          ? [
              { label: t("Speed 0.5×"), icon: <Gauge size={14} />, onClick: () => A.setSpeed(c.id, 0.5) },
              { label: t("Speed 1× (normal)"), icon: <Gauge size={14} />, onClick: () => A.setSpeed(c.id, 1) },
              { label: t("Speed 2×"), icon: <Gauge size={14} />, onClick: () => A.setSpeed(c.id, 2) },
            ]
          : []),
        { label: t("Add cross dissolve"), icon: <ArrowRightLeft size={14} />, onClick: () => A.applyTransition("dissolve", "in") },
        { label: t("Remove transitions"), icon: <ArrowRightLeft size={14} />, disabled: !c.transitionIn && !c.transitionOut, onClick: () => A.applyTransition(null, "both") },
        { separator: true },
        { label: t("Delete"), icon: <Trash2 size={14} />, shortcut: "Del", danger: true, onClick: () => A.deleteSelection(false) },
        { label: t("Ripple delete"), icon: <Trash2 size={14} />, shortcut: "Shift+Del", danger: true, onClick: () => A.deleteSelection(true) },
      ]);
    },
    [t],
  );


  const laneMenu = (e: React.MouseEvent, track: Track) => {
    const time = timeAt(e.clientX);
    openContextMenu(e, [
      {
        label: t("Paste here"),
        icon: <ClipboardPaste size={14} />,
        disabled: !useUi.getState().clipboard.length,
        onClick: () => {
          let ids: string[] = [];
          useProject.getState().commit(t("Paste"), (d) => void (ids = ops.pasteClips(d, useUi.getState().clipboard, time, track.id)));
          useUi.getState().select(ids);
        },
      },
      { label: t("Close gap here"), icon: <SquareSplitHorizontal size={14} />, onClick: () => useProject.getState().commit(t("Close gap"), (d) => void ops.closeGapAt(d, track.id, time)) },
      { label: t("Add text here"), icon: <Type size={14} />, onClick: () => A.addText(t("Your text"), {}, undefined, time) },
    ]);
  };

  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    useUi.getState().select([]);
    scrub(e);
  };


  const addTrack = (kind: Track["kind"]) => useProject.getState().commit(t("Add track"), (d) => void ops.addTrack(d, kind));
  const clipsByTrack = useMemo(() => {
    const m = new Map<string, Clip[]>();
    for (const c of Object.values(shown.clips)) {
      if (!m.has(c.trackId)) m.set(c.trackId, []);
      m.get(c.trackId)!.push(c);
    }
    return m;
  }, [shown.clips]);

  return (
    <div className="flex h-full flex-col bg-panel" dir="ltr">
      {/* toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-2">
        <IconBtn tip={t("Split at playhead")} shortcut="S" onClick={A.splitAtPlayhead}>
          <Scissors size={15} />
        </IconBtn>
        <IconBtn tip={t("Delete")} shortcut="Del" onClick={() => A.deleteSelection(false)} disabled={!selection.length}>
          <Trash2 size={15} />
        </IconBtn>
        <IconBtn tip={t("Ripple delete")} shortcut="Shift+Del" onClick={() => A.deleteSelection(true)} disabled={!selection.length}>
          <SquareSplitHorizontal size={15} />
        </IconBtn>
        <IconBtn tip={t("Detach audio")} onClick={A.detachAudioSelected} disabled={!selection.length}>
          <Unlink size={15} />
        </IconBtn>
        <div className="mx-1.5 h-5 w-px bg-line" />
        <IconBtn tip={t("Snapping")} shortcut="N" active={snapping} onClick={() => setUi({ snapping: !snapping })}>
          <Magnet size={15} />
        </IconBtn>
        <IconBtn tip={t("Ripple mode (trims and deletes close gaps)")} shortcut="R" active={ripple} onClick={() => setUi({ ripple: !ripple })}>
          <ArrowRightLeft size={15} />
        </IconBtn>
        <div className="mx-1.5 h-5 w-px bg-line" />
        <IconBtn tip={t("Add video track")} onClick={() => addTrack("video")}>
          <span className="relative">
            <Film size={15} />
            <Plus size={9} className="absolute -right-1.5 -top-1" />
          </span>
        </IconBtn>
        <IconBtn tip={t("Add audio track")} onClick={() => addTrack("audio")}>
          <span className="relative">
            <AudioLines size={15} />
            <Plus size={9} className="absolute -right-1.5 -top-1" />
          </span>
        </IconBtn>
        <IconBtn tip={t("Add text track")} onClick={() => addTrack("text")}>
          <span className="relative">
            <Type size={15} />
            <Plus size={9} className="absolute -right-1.5 -top-1" />
          </span>
        </IconBtn>
        <div className="flex-1" />
        <span className="me-2 text-[11px] text-dim tabular-nums">{t("{{n}} selected", { n: selection.length })}</span>
        <IconBtn tip={t("Zoom out")} shortcut="−" onClick={() => useUi.getState().setZoom(zoom / 1.25)}>
          <ZoomOut size={15} />
        </IconBtn>
        <input type="range" className="w-28" min={Math.log(MIN_ZOOM)} max={Math.log(MAX_ZOOM)} step={0.01} value={Math.log(zoom)} onChange={(e) => useUi.getState().setZoom(Math.exp(parseFloat(e.target.value)))} />
        <IconBtn tip={t("Zoom in")} shortcut="+" onClick={() => useUi.getState().setZoom(zoom * 1.25)}>
          <ZoomIn size={15} />
        </IconBtn>
        <IconBtn tip={t("Zoom to fit")} shortcut="Shift+Z" onClick={() => A.zoomToFit(view.width)}>
          <Maximize2 size={15} />
        </IconBtn>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* headers */}
        <div className="flex shrink-0 flex-col border-e border-line" style={{ width: HEADER_W }}>
          <div className="h-[26px] shrink-0 border-b border-line bg-panel" />
          <div ref={headRef} className="min-h-0 flex-1 overflow-hidden">
            {shown.tracks.map((tr, i) => (
              <TrackHeader key={tr.id} track={tr} height={trackHeight(tr)} index={i} count={shown.tracks.length} />
            ))}
          </div>
        </div>
        {/* lanes */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto bg-bg" onScroll={onScroll} onWheel={onWheel}>
          <Ruler zoom={zoom} width={contentW} scrollLeft={view.left} viewWidth={view.width} onScrub={scrub} />
          <div className="relative" style={{ width: contentW, height: Math.max(totalH, 40) }}>
            {shown.tracks.map((tr, i) => (
              <div
                key={tr.id}
                className={cx("absolute inset-x-0 border-b border-line/70", i % 2 ? "bg-white/[0.012]" : "", dropHint?.trackId === tr.id && "bg-accent/10")}
                style={{ top: rows[i].top, height: rows[i].height }}
                onPointerDown={onLaneDown}
                onContextMenu={(e) => laneMenu(e, tr)}
              >
                {(clipsByTrack.get(tr.id) ?? []).map((c) => (
                  <ClipView
                    key={c.id}
                    clip={c}
                    media={isMediaClip(c) ? shown.media.find((m) => m.id === c.mediaId) : undefined}
                    track={tr}
                    zoom={zoom}
                    selected={selection.includes(c.id)}
                    ghost={!!drag?.started && drag.ids.includes(c.id)}
                    viewLeft={view.left}
                    viewWidth={view.width}
                    onDown={onClipDown}
                    onMenu={onClipMenu}
                    dropEdge={clipHint?.id === c.id ? clipHint.edge : undefined}
                  />
                ))}
              </div>
            ))}
            {drag?.snapAt !== undefined && <div className="pointer-events-none absolute top-0 z-30 w-px bg-amber-300" style={{ left: drag.snapAt * zoom, height: totalH }} />}
            {dropHint && <div className="pointer-events-none absolute top-0 z-30 w-0.5 bg-violet-400" style={{ left: dropHint.time * zoom, height: totalH }} />}
            <Playhead zoom={zoom} height={totalH} />
          </div>
        </div>
      </div>
    </div>
  );
}
