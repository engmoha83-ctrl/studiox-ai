import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronFirst, ChevronLast, Grid3x3, Maximize, Minimize, Pause, Play, StepBack, StepForward } from "lucide-react";
import { PreviewEngine } from "../../preview/PreviewEngine";
import { attachEngine, player } from "../../preview/player";
import { projectDuration } from "../../engine/timelineOps";
import { ASPECT_PRESETS } from "../../engine/presets";
import { timecode } from "../../lib/time";
import { api } from "../../backend/api";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { isMediaClip, isTextClip } from "../../types/project";
import { IconBtn, Select, cx } from "../common/ui";

function Timecode() {
  const playhead = useUi((s) => s.playhead);
  const project = useProject((s) => s.project)!;
  return (
    <span className="font-mono text-[12px] tabular-nums" dir="ltr">
      <span className="text-fg">{timecode(playhead, project.settings.fps)}</span>
      <span className="text-dim"> / {timecode(projectDuration(project), project.settings.fps)}</span>
    </span>
  );
}

/** Scrubbable progress bar (also used in full-screen preview). */
function SeekBar() {
  const playhead = useUi((s) => s.playhead);
  const project = useProject((s) => s.project)!;
  const duration = projectDuration(project);
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || duration <= 0) return;
    const wasPlaying = useUi.getState().playing;
    player.pause();
    player.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => player.seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (wasPlaying) player.play();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const pct = duration > 0 ? Math.min(100, (playhead / duration) * 100) : 0;
  return (
    <div
      ref={ref}
      data-seekbar
      className="group relative h-4 shrink-0 cursor-pointer px-0"
      onPointerDown={down}
      onPointerMove={(e) => setHover(timeAt(e.clientX))}
      onPointerLeave={() => setHover(null)}
      dir="ltr"
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line-2 transition-[height] group-hover:h-1.5">
        <div className="h-full rounded-full grad-bg" style={{ width: `${pct}%` }} />
      </div>
      <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${pct}%` }} />
      {hover !== null && duration > 0 && (
        <div className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums" style={{ left: `${(hover / duration) * 100}%` }}>
          {timecode(hover, project.settings.fps)}
        </div>
      )}
    </div>
  );
}

function SelectionOverlay({ engine, scale }: { engine: PreviewEngine | null; scale: number }) {
  const selection = useUi((s) => s.selection);
  const playhead = useUi((s) => s.playhead);
  const project = useProject((s) => s.project)!;
  const id = selection.length === 1 ? selection[0] : null;
  const clip = id ? project.clips[id] : undefined;
  void playhead;
  if (!engine || !clip) return null;
  const locked = project.tracks.find((t) => t.id === clip.trackId)?.locked;
  let box: { left: number; top: number; width: number; height: number; rotation: number } | null = null;
  if (isMediaClip(clip)) {
    const b = engine.clipBox(clip.id);
    if (b) box = { left: (b.cx - b.w / 2) * scale, top: (b.cy - b.h / 2) * scale, width: b.w * scale, height: b.h * scale, rotation: b.rotation };
  } else if (isTextClip(clip)) {
    const b = engine.textBox(clip.id);
    if (b) box = { left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale, rotation: 0 };
  }
  if (!box) return null;
  const onDown = (e: React.PointerEvent) => {
    if (locked || e.button !== 0) return;
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const unit = engine.unit;
    const start = isMediaClip(clip) ? { x: clip.transform.x, y: clip.transform.y } : { x: clip.style.x, y: clip.style.y };
    const W = engine.canvasElement().width;
    const H = engine.canvasElement().height;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      useProject.getState().commit(
        "Move",
        (d) => {
          const c = d.clips[clip.id];
          if (isMediaClip(c)) {
            c.transform.x = Math.round(start.x + dx / unit);
            c.transform.y = Math.round(start.y + dy / unit);
          } else if (isTextClip(c)) {
            c.style.x = +(start.x + dx / W).toFixed(4);
            c.style.y = +(start.y + dy / H).toFixed(4);
          }
        },
        `move:${clip.id}`,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={onDown}
      className={cx("absolute border-2 border-violet-400/90", locked ? "cursor-not-allowed" : "cursor-move")}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: `rotate(${box.rotation}deg)`, boxShadow: "0 0 0 1px rgba(0,0,0,.6)" }}
    >
      {["-start-1 -top-1", "-end-1 -top-1", "-start-1 -bottom-1", "-end-1 -bottom-1"].map((p) => (
        <span key={p} className={`absolute size-2 rounded-sm bg-white ${p}`} />
      ))}
    </div>
  );
}

export default function PreviewPanel() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<PreviewEngine | null>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const project = useProject((s) => s.project)!;
  const playing = useUi((s) => s.playing);
  const quality = useUi((s) => s.previewQuality);
  const rate = useUi((s) => s.playbackRate);
  const safe = useUi((s) => s.safeArea);
  const fullscreen = useUi((s) => s.previewFullscreen);
  const set = useUi((s) => s.set);

  useEffect(() => {
    const e = new PreviewEngine(canvasRef.current!);
    e.setQuality(useUi.getState().previewQuality);
    e.setProject(useProject.getState().project);
    attachEngine(e);
    setEngine(e);
    const unsub = useProject.subscribe((s) => e.setProject(s.project));
    return () => {
      unsub();
      attachEngine(null);
      e.destroy();
    };
  }, []);
  useEffect(() => engine?.setQuality(quality), [engine, quality]);

  // fit the canvas into the available area keeping the project aspect ratio
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const ar = project.settings.width / project.settings.height;
      let w = r.width - 24;
      let h = w / ar;
      if (h > r.height - 24) {
        h = r.height - 24;
        w = h * ar;
      }
      setFit({ w: Math.max(0, w), h: Math.max(0, h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.settings.width, project.settings.height, fullscreen]);

  const aspectId = ASPECT_PRESETS.find((a) => Math.abs(a.width / a.height - project.settings.width / project.settings.height) < 0.01)?.id ?? "custom";
  const setAspect = (id: string) => {
    const a = ASPECT_PRESETS.find((x) => x.id === id);
    if (!a) return;
    const short = Math.min(project.settings.width, project.settings.height);
    const r = a.width / a.height;
    const even = (n: number) => Math.round(n / 2) * 2;
    const w = r >= 1 ? even(short * r) : short;
    const h = r >= 1 ? short : even(short / r);
    useProject.getState().commit(t("Aspect ratio"), (d) => {
      d.settings.width = w;
      d.settings.height = h;
    });
  };

  const scale = engine && fit.w ? fit.w / engine.canvasElement().width : 1;

  return (
    <div className={cx("flex h-full flex-col bg-[#07080b]", fullscreen && "fixed inset-0 z-[90]")}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Preview")}</span>
        <div className="flex-1" />
        <div className="w-[92px]">
          <Select
            value={aspectId}
            onChange={setAspect}
            options={[...ASPECT_PRESETS.map((a) => ({ value: a.id, label: a.label })), ...(aspectId === "custom" ? [{ value: "custom", label: t("Custom") }] : [])]}
          />
        </div>
        <div className="w-[150px]" title={t("Preview render resolution — lower is smoother on slower computers. Export always uses full quality.")}>
          <Select
            value={quality}
            onChange={(q) => {
              set({ previewQuality: q });
              void api.setSetting("previewQuality", String(q));
            }}
            options={([1, 0.5, 0.25] as const).map((q) => ({
              value: q,
              label: `${t(q === 1 ? "Full" : q === 0.5 ? "Half" : "Quarter")} · ${Math.round(project.settings.width * q)}×${Math.round(project.settings.height * q)}`,
            }))}
          />
        </div>
        <IconBtn tip={t("Safe areas")} active={safe} onClick={() => set({ safeArea: !safe })}>
          <Grid3x3 size={15} />
        </IconBtn>
      </div>
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" dir="ltr" onPointerDown={() => useUi.getState().select([])}>
        <div className="relative shadow-2xl" style={{ width: fit.w, height: fit.h }}>
          <canvas ref={canvasRef} className="block size-full" />
          {safe && (
            <>
              <div className="pointer-events-none absolute border border-dashed border-amber-300/60" style={{ inset: "5%" }} />
              <div className="pointer-events-none absolute border border-dashed border-sky-300/50" style={{ inset: "10%" }} />
              <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-white/15" />
              <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full bg-white/15" />
            </>
          )}
          <SelectionOverlay engine={engine} scale={scale} />
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-panel px-3 pt-1.5">
        <SeekBar />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-1 bg-panel px-3" dir="ltr">
        <Timecode />
        <div className="flex flex-1 items-center justify-center gap-0.5">
          <IconBtn tip={t("Go to start")} shortcut="Home" onClick={() => player.seek(0)}>
            <ChevronFirst size={17} />
          </IconBtn>
          <IconBtn tip={t("Previous frame")} shortcut="←" onClick={() => player.step(-1)}>
            <StepBack size={16} />
          </IconBtn>
          <button onClick={() => player.toggle()} className="mx-1 flex size-9 items-center justify-center rounded-full bg-white text-black hover:bg-violet-100" aria-label={t("Play / pause")} title={`${t("Play / pause")} (Space)`}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ms-0.5" />}
          </button>
          <IconBtn tip={t("Next frame")} shortcut="→" onClick={() => player.step(1)}>
            <StepForward size={16} />
          </IconBtn>
          <IconBtn tip={t("Go to end")} shortcut="End" onClick={() => player.seek(Infinity)}>
            <ChevronLast size={17} />
          </IconBtn>
        </div>
        <div className="w-[78px]">
          <Select value={rate} onChange={(r) => player.setRate(r)} options={[0.25, 0.5, 1, 1.5, 2].map((r) => ({ value: r, label: `${r}×` }))} />
        </div>
        <IconBtn tip={fullscreen ? t("Exit full screen") : t("Full screen")} shortcut="F" onClick={() => set({ previewFullscreen: !fullscreen })}>
          {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </IconBtn>
      </div>
    </div>
  );
}
