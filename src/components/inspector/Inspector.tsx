import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlignCenter, AlignLeft, AlignRight, FlipHorizontal, FlipVertical, Plus, RefreshCw, RotateCcw, Trash2, Unlink } from "lucide-react";
import * as ops from "../../engine/timelineOps";
import { FONTS } from "../../engine/fonts";
import { TRANSITIONS } from "../sidebar/TransitionsPanel";
import { formatBytes, shortTime } from "../../lib/time";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { useApp } from "../../store/appStore";
import { addMediaToTimeline, deleteSelection, detachAudioSelected, setSpeed } from "../../editor/actions";
import { createProxy, proxyProgress } from "../../services/media";
import { isMediaClip, isTextClip, type Clip, type MediaClip, type Project, type TextAnimation, type TextClip, type Transition } from "../../types/project";
import { Button, IconBtn, NumberField, Row, Section, Select, Slider, Toggle, cx } from "../common/ui";
import { AudioFxSection, ColorPanel, EasingRow, EffectsPanel, KfButton, propValue, setProp, useLocalTime } from "./M4Panels";

type Recipe<T> = (c: T) => void;

function useEdit<T extends Clip>(id: string) {
  const commit = useProject((s) => s.commit);
  return (label: string, key: string, f: Recipe<T>) =>
    commit(
      label,
      (d) => {
        const c = d.clips[id] as T | undefined;
        if (c) f(c);
      },
      `${key}:${id}`,
    );
}

function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-line px-2 pt-2">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx("rounded-t-md px-3 pb-2 pt-1 text-[12px] font-medium", value === t.id ? "border-b-2 border-accent text-fg" : "text-muted hover:text-fg")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TransitionRow({ label, value, onChange, max }: { label: string; value?: Transition | null; onChange: (v: Transition | null) => void; max: number }) {
  const { t } = useTranslation();
  return (
    <Row label={label}>
      <Select
        value={value?.type ?? "none"}
        onChange={(v) => onChange(v === "none" ? null : { type: v as Transition["type"], duration: Math.min(value?.duration ?? 0.6, max) })}
        options={[{ value: "none", label: t("None") }, ...TRANSITIONS.map((x) => ({ value: x.type, label: t(x.name) }))]}
      />
      {value && <NumberField className="w-[70px] shrink-0" value={value.duration} onChange={(d) => onChange({ ...value, duration: Math.min(Math.max(0.05, d), max) })} step={0.05} suffix="s" />}
    </Row>
  );
}

// ------------------------------------------------------------------ media clip

function MediaClipInspector({ clip, project }: { clip: MediaClip; project: Project }) {
  const { t } = useTranslation();
  const media = project.media.find((m) => m.id === clip.mediaId);
  const edit = useEdit<MediaClip>(clip.id);
  const visual = media?.kind !== "audio";
  const audible = !!media?.hasAudio && media.kind !== "image";
  const [tab, setTab] = useState(visual ? "video" : "audio");
  const cur = !visual && tab === "video" ? "audio" : !audible && tab === "audio" ? "video" : tab;
  const tabs = [
    ...(visual ? [{ id: "video", label: t("Video") }, { id: "color", label: t("Colour") }, { id: "effects", label: t("Effects") }] : []),
    ...(audible ? [{ id: "audio", label: t("Audio") }] : []),
    ...(media?.kind !== "image" ? [{ id: "speed", label: t("Speed") }] : []),
  ];
  const tr = clip.transform;
  const local = useLocalTime(clip);
  const pv = (p: "x" | "y" | "scale" | "rotation" | "opacity" | "volume") => propValue(clip, p, local);
  return (
    <>
      <Tabs tabs={tabs} value={cur} onChange={setTab} />
      {cur === "video" && (
        <>
          <Section
            title={t("Transform")}
            right={
              <IconBtn tip={t("Reset")} onClick={() => edit(t("Reset transform"), "reset", (c) => void (c.transform = { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false }))}>
                <RotateCcw size={13} />
              </IconBtn>
            }
          >
            <Row label={t("Position X")}>
              <NumberField value={pv("x")} onChange={(v) => setProp(clip, "x", v, t("Position"))} suffix="px" precision={0} />
              <KfButton clip={clip} prop="x" />
            </Row>
            <Row label={t("Position Y")}>
              <NumberField value={pv("y")} onChange={(v) => setProp(clip, "y", v, t("Position"))} suffix="px" precision={0} />
              <KfButton clip={clip} prop="y" />
            </Row>
            <Row label={t("Scale")}>
              <Slider value={pv("scale")} min={0.05} max={4} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => setProp(clip, "scale", v, t("Scale"))} />
              <KfButton clip={clip} prop="scale" />
            </Row>
            <Row label={t("Rotation")}>
              <Slider value={pv("rotation")} min={-180} max={180} step={1} precision={0} suffix="°" onChange={(v) => setProp(clip, "rotation", v, t("Rotation"))} />
              <KfButton clip={clip} prop="rotation" />
            </Row>
            <Row label={t("Flip")}>
              <IconBtn tip={t("Flip horizontal")} active={tr.flipH} onClick={() => edit(t("Flip"), "fh" + Date.now(), (c) => void (c.transform.flipH = !c.transform.flipH))}>
                <FlipHorizontal size={15} />
              </IconBtn>
              <IconBtn tip={t("Flip vertical")} active={tr.flipV} onClick={() => edit(t("Flip"), "fv" + Date.now(), (c) => void (c.transform.flipV = !c.transform.flipV))}>
                <FlipVertical size={15} />
              </IconBtn>
            </Row>
            <Row label={t("Opacity")}>
              <Slider value={pv("opacity")} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => setProp(clip, "opacity", v, t("Opacity"))} />
              <KfButton clip={clip} prop="opacity" />
            </Row>
            <EasingRow clip={clip} />
            <p className="text-[11px] leading-snug text-dim">{t("◆ adds a keyframe at the playhead; once a property has keyframes, editing it updates the keyframe at the playhead.")}</p>
          </Section>
          <Section title={t("Crop")}>
            {(["left", "right", "top", "bottom"] as const).map((k) => (
              <Row key={k} label={t(k[0].toUpperCase() + k.slice(1))}>
                <Slider value={clip.crop[k]} min={0} max={0.45} step={0.005} display={(v) => v * 100} precision={1} suffix="%" onChange={(v) => edit(t("Crop"), "crop" + k, (c) => void (c.crop[k] = v))} />
              </Row>
            ))}
          </Section>
          <Section title={t("Transitions")}>
            <TransitionRow label={t("In")} value={clip.transitionIn} max={clip.duration / 2} onChange={(v) => edit(t("Transition"), "tin", (c) => void (c.transitionIn = v))} />
            <TransitionRow label={t("Out")} value={clip.transitionOut} max={clip.duration / 2} onChange={(v) => edit(t("Transition"), "tout", (c) => void (c.transitionOut = v))} />
          </Section>
        </>
      )}
      {cur === "audio" && (
        <Section title={t("Audio")}>
          <Row label={t("Volume")}>
            <Slider value={pv("volume")} min={0} max={2} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => setProp(clip, "volume", v, t("Volume"))} />
            <KfButton clip={clip} prop="volume" />
          </Row>
          {clip.volume > 1 && <p className="text-[11px] text-dim">{t("Gain above 100% is applied in the export; the preview plays at 100%.")}</p>}
          <Row label={t("Fade in")}>
            <NumberField value={clip.audioFadeIn} min={0} max={clip.duration / 2} step={0.05} suffix="s" onChange={(v) => edit(t("Fade in"), "afi", (c) => void (c.audioFadeIn = v))} />
          </Row>
          <Row label={t("Fade out")}>
            <NumberField value={clip.audioFadeOut} min={0} max={clip.duration / 2} step={0.05} suffix="s" onChange={(v) => edit(t("Fade out"), "afo", (c) => void (c.audioFadeOut = v))} />
          </Row>
          <Row label={t("Mute clip")}>
            <Toggle checked={clip.muted} onChange={(v) => edit(t("Mute"), "mute" + Date.now(), (c) => void (c.muted = v))} />
          </Row>
          {media?.kind === "video" && (
            <Button className="w-full" disabled={clip.muted} onClick={detachAudioSelected}>
              <Unlink size={14} />
              {t("Detach audio to an audio track")}
            </Button>
          )}
        </Section>
      )}
      {cur === "audio" && <AudioFxSection clip={clip} />}
      {cur === "color" && <ColorPanel clip={clip} />}
      {cur === "effects" && <EffectsPanel clip={clip} />}
      {cur === "speed" && (
        <Section title={t("Speed")}>
          <Row label={t("Speed")}>
            <NumberField value={clip.speed} min={0.1} max={16} step={0.05} suffix="×" onChange={(v) => setSpeed(clip.id, v)} />
          </Row>
          <div className="flex flex-wrap gap-1.5">
            {[0.25, 0.5, 1, 1.5, 2, 4, 8].map((s) => (
              <button key={s} onClick={() => setSpeed(clip.id, s)} className={cx("rounded-md border px-2 py-1 text-[11.5px]", Math.abs(clip.speed - s) < 1e-3 ? "border-accent bg-accent/15" : "border-line-2 hover:bg-panel-3")}>
                {s}×
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-dim">
            {t("Duration")}: <span dir="ltr">{shortTime(clip.duration)} ({clip.duration.toFixed(2)}s)</span>
          </p>
          <p className="text-[11px] text-dim">{t("Audio pitch is preserved when the speed changes.")}</p>
        </Section>
      )}
      <ClipFooter clip={clip} />
    </>
  );
}

// ------------------------------------------------------------------ text clip

const ANIMS: TextAnimation[] = ["none", "fade", "slide-up", "slide-down"];

function TextClipInspector({ clip }: { clip: TextClip }) {
  const { t } = useTranslation();
  const edit = useEdit<TextClip>(clip.id);
  const s = clip.style;
  const st = (label: string, key: string, f: Recipe<TextClip["style"]>) => edit(label, key, (c) => f(c.style));
  const font = FONTS.find((f) => f.family === s.fontFamily);
  const [tab, setTab] = useState("text");
  return (
    <>
      <Tabs
        tabs={[
          { id: "text", label: t("Text") },
          { id: "style", label: t("Style") },
          { id: "anim", label: t("Animation") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "text" && (
        <Section title={t("Content")}>
          <textarea
            dir="auto"
            className="h-24 w-full resize-y rounded-md border border-line-2 bg-panel-2 p-2 text-[13px] outline-none focus:border-accent"
            style={{ fontFamily: `"${s.fontFamily}"` }}
            value={clip.text}
            onChange={(e) => edit(t("Edit text"), "text", (c) => void (c.text = e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Row label={t("Font")}>
            <Select
              value={s.fontFamily}
              onChange={(v) =>
                st(t("Font"), "font", (x) => {
                  x.fontFamily = v;
                  const f = FONTS.find((y) => y.family === v);
                  if (f && !f.weights.includes(x.fontWeight)) x.fontWeight = f.weights[f.weights.length - 1];
                })
              }
              options={FONTS.map((f) => ({ value: f.family, label: `${f.family}${f.arabic ? "  · عربي" : ""}${f.bundled ? "" : " *"}` }))}
            />
          </Row>
          <Row label={t("Weight")}>
            <Select value={s.fontWeight} onChange={(v) => st(t("Font weight"), "fw", (x) => void (x.fontWeight = v))} options={(font?.weights ?? [400, 700]).map((w) => ({ value: w, label: String(w) }))} />
            <IconBtn tip={t("Italic")} active={s.italic} onClick={() => st(t("Italic"), "it" + Date.now(), (x) => void (x.italic = !x.italic))}>
              <i className="font-serif text-[14px]">I</i>
            </IconBtn>
          </Row>
          <Row label={t("Size")}>
            <Slider value={s.fontSize} min={8} max={400} step={1} precision={0} suffix="px" onChange={(v) => st(t("Font size"), "fs", (x) => void (x.fontSize = v))} />
          </Row>
          <Row label={t("Color")}>
            <input type="color" value={s.color} onChange={(e) => st(t("Color"), "color", (x) => void (x.color = e.target.value))} />
            <div className="ms-auto flex">
              {(
                [
                  ["start", <AlignLeft key="s" size={14} />],
                  ["center", <AlignCenter key="c" size={14} />],
                  ["end", <AlignRight key="e" size={14} />],
                ] as [TextClip["style"]["align"], ReactNode][]
              ).map(([a, icon]) => (
                <IconBtn key={a} tip={t(a === "start" ? "Align start" : a === "end" ? "Align end" : "Align center")} active={s.align === a} onClick={() => st(t("Alignment"), "al" + Date.now(), (x) => void (x.align = a))}>
                  {icon}
                </IconBtn>
              ))}
            </div>
          </Row>
          <Row label={t("Direction")}>
            <Select
              value={s.direction}
              onChange={(v) => st(t("Text direction"), "dir", (x) => void (x.direction = v))}
              options={[
                { value: "auto", label: t("Automatic") },
                { value: "rtl", label: t("Right to left") },
                { value: "ltr", label: t("Left to right") },
              ]}
            />
          </Row>
          <Row label={t("Digits")}>
            <Toggle checked={s.arabicDigits} onChange={(v) => st(t("Digits"), "dg" + Date.now(), (x) => void (x.arabicDigits = v))} label={t("Arabic-Indic (٠١٢٣)")} />
          </Row>
          <Row label={t("Line height")}>
            <Slider value={s.lineHeight} min={0.8} max={2.5} step={0.05} onChange={(v) => st(t("Line height"), "lh", (x) => void (x.lineHeight = v))} />
          </Row>
          <Row label={t("Spacing")}>
            <Slider value={s.letterSpacing} min={-5} max={40} step={0.5} precision={1} suffix="px" onChange={(v) => st(t("Letter spacing"), "ls", (x) => void (x.letterSpacing = v))} />
          </Row>
          {s.letterSpacing !== 0 && font?.arabic && <p className="text-[11px] text-amber-300/80">{t("Letter spacing breaks Arabic letter joining — keep it at 0 for Arabic text.")}</p>}
        </Section>
      )}
      {tab === "style" && (
        <>
          <Section title={t("Position")}>
            <Row label={t("Position")}>
              <NumberField value={s.x * 100} onChange={(v) => st(t("Position"), "tx", (x) => void (x.x = v / 100))} suffix="%X" precision={1} />
              <NumberField value={s.y * 100} onChange={(v) => st(t("Position"), "ty", (x) => void (x.y = v / 100))} suffix="%Y" precision={1} />
            </Row>
            <Row label={t("Max width")}>
              <Slider value={s.maxWidth} min={0.1} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => st(t("Max width"), "mw", (x) => void (x.maxWidth = v))} />
            </Row>
            <Row label={t("Opacity")}>
              <Slider value={clip.opacity} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => edit(t("Opacity"), "op", (c) => void (c.opacity = v))} />
            </Row>
          </Section>
          <Section title={t("Outline")}>
            <Row label={t("Width")}>
              <Slider value={s.outlineWidth} min={0} max={20} step={0.5} precision={1} suffix="px" onChange={(v) => st(t("Outline"), "ow", (x) => void (x.outlineWidth = v))} />
              <input type="color" value={s.outlineColor} onChange={(e) => st(t("Outline"), "oc", (x) => void (x.outlineColor = e.target.value))} />
            </Row>
          </Section>
          <Section title={t("Shadow")}>
            <Row label={t("Blur")}>
              <Slider value={s.shadowBlur} min={0} max={60} step={1} precision={0} suffix="px" onChange={(v) => st(t("Shadow"), "sb", (x) => void (x.shadowBlur = v))} />
              <input type="color" value={s.shadowColor} onChange={(e) => st(t("Shadow"), "sc", (x) => void (x.shadowColor = e.target.value))} />
            </Row>
            <Row label={t("Offset")}>
              <NumberField value={s.shadowOffsetX} onChange={(v) => st(t("Shadow"), "sx", (x) => void (x.shadowOffsetX = v))} suffix="X" precision={0} />
              <NumberField value={s.shadowOffsetY} onChange={(v) => st(t("Shadow"), "sy", (x) => void (x.shadowOffsetY = v))} suffix="Y" precision={0} />
            </Row>
          </Section>
          <Section title={t("Background")}>
            <Row label={t("Opacity")}>
              <Slider value={s.backgroundOpacity} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => st(t("Background"), "bo", (x) => void (x.backgroundOpacity = v))} />
              <input type="color" value={s.backgroundColor} onChange={(e) => st(t("Background"), "bc", (x) => void (x.backgroundColor = e.target.value))} />
            </Row>
            <Row label={t("Padding")}>
              <Slider value={s.backgroundPadding} min={0} max={120} step={1} precision={0} suffix="px" onChange={(v) => st(t("Background"), "bp", (x) => void (x.backgroundPadding = v))} />
            </Row>
            <Row label={t("Radius")}>
              <Slider value={s.backgroundRadius} min={0} max={80} step={1} precision={0} suffix="px" onChange={(v) => st(t("Background"), "br", (x) => void (x.backgroundRadius = v))} />
            </Row>
          </Section>
        </>
      )}
      {tab === "anim" && (
        <Section title={t("Animation")}>
          <Row label={t("In")}>
            <Select value={clip.animIn} onChange={(v) => edit(t("Animation"), "ai", (c) => void (c.animIn = v))} options={ANIMS.map((a) => ({ value: a, label: t(animName(a)) }))} />
          </Row>
          <Row label={t("Out")}>
            <Select value={clip.animOut} onChange={(v) => edit(t("Animation"), "ao", (c) => void (c.animOut = v))} options={ANIMS.map((a) => ({ value: a, label: t(animName(a)) }))} />
          </Row>
          <Row label={t("Duration")}>
            <NumberField value={clip.animDuration} min={0.05} max={clip.duration / 2} step={0.05} suffix="s" onChange={(v) => edit(t("Animation"), "ad", (c) => void (c.animDuration = v))} />
          </Row>
        </Section>
      )}
      <ClipFooter clip={clip} />
    </>
  );
}

const animName = (a: TextAnimation) => ({ none: "None", fade: "Fade", "slide-up": "Slide up", "slide-down": "Slide down", pop: "Pop", typewriter: "Typewriter" })[a];

function ClipFooter({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const fps = project.settings.fps;
  return (
    <Section title={t("Timing")}>
      <Row label={t("Start")}>
        <NumberField
          value={clip.start}
          min={0}
          step={1 / fps}
          precision={3}
          suffix="s"
          onChange={(v) => useProject.getState().commit(t("Move"), (d) => ops.moveClips(d, [{ id: clip.id, start: v, trackId: clip.trackId }]), `start:${clip.id}`)}
        />
      </Row>
      <Row label={t("Duration")}>
        <NumberField
          value={clip.duration}
          min={1 / fps}
          step={1 / fps}
          precision={3}
          suffix="s"
          onChange={(v) => useProject.getState().commit(t("Trim"), (d) => ops.trimClip(d, clip.id, "end", clip.start + v), `dur:${clip.id}`)}
        />
      </Row>
      <Button variant="ghost" className="w-full text-red-300" onClick={() => deleteSelection(false)}>
        <Trash2 size={14} />
        {t("Delete clip")}
      </Button>
    </Section>
  );
}

// ------------------------------------------------------------------ media info / project

function MediaInfo({ id }: { id: string }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const m = project.media.find((x) => x.id === id);
  if (!m) return null;
  const rows: [string, string][] = [
    [t("Type"), t(m.kind === "video" ? "Video" : m.kind === "audio" ? "Audio" : "Image")],
    ...(m.kind !== "image" ? ([[t("Duration"), `${shortTime(m.duration)} (${m.duration.toFixed(2)}s)`]] as [string, string][]) : []),
    ...(m.width ? ([[t("Resolution"), `${m.width} × ${m.height}`]] as [string, string][]) : []),
    ...(m.fps ? ([[t("Frame rate"), `${m.fps.toFixed(3).replace(/\.?0+$/, "")} fps`]] as [string, string][]) : []),
    [t("Video codec"), m.videoCodec ?? "—"],
    [t("Audio codec"), m.audioCodec ?? "—"],
    [t("Container"), m.formatName ?? "—"],
    [t("File size"), formatBytes(m.size)],
    [t("Proxy"), m.proxyState === "ready" ? t("Ready") : m.proxyState === "pending" ? `${t("Generating")} ${Math.round((proxyProgress[m.id] ?? 0) * 100)}%` : m.proxyState === "failed" ? t("Failed") : t("Not needed / none")],
  ];
  return (
    <div className="h-full overflow-auto">
      <Section title={t("Media info")}>
        <div className="truncate font-medium" dir="auto" title={m.path}>
          {m.name}
        </div>
        <div className="break-all text-[11px] text-dim" dir="ltr">
          {m.path}
        </div>
        {m.missing && <div className="rounded-md bg-red-500/15 p-2 text-[12px] text-red-200">{t("File is missing")}</div>}
        <table className="w-full text-[12px]">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pe-2 text-muted">{k}</td>
                <td className="py-0.5 text-end tabular-nums" dir="ltr">
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => addMediaToTimeline(m)} disabled={m.missing}>
            <Plus size={14} />
            {t("Add to timeline")}
          </Button>
          {m.kind !== "image" && (
            <Button onClick={() => void createProxy(m.id)} disabled={m.proxyState === "pending" || m.missing} title={t("Generate proxy")}>
              <RefreshCw size={14} />
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}

function ProjectInfo() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const commit = useProject((s) => s.commit);
  const clips = Object.values(project.clips);
  return (
    <div className="h-full overflow-auto">
      <Section title={t("Project")}>
        <Row label={t("Resolution")}>
          <span dir="ltr">
            {project.settings.width} × {project.settings.height}
          </span>
        </Row>
        <Row label={t("Frame rate")}>
          <span dir="ltr">{project.settings.fps} fps</span>
        </Row>
        <Row label={t("Duration")}>
          <span dir="ltr">{shortTime(ops.projectDuration(project))}</span>
        </Row>
        <Row label={t("Background")}>
          <input type="color" value={project.settings.background} onChange={(e) => commit(t("Background color"), (d) => void (d.settings.background = e.target.value), "bg")} />
        </Row>
        <Row label={t("Master volume")}>
          <Slider value={project.master?.volume ?? 1} min={0} max={2} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => commit(t("Master volume"), (d) => void (d.master = { limiter: d.master?.limiter ?? false, volume: v }), "mvol")} />
        </Row>
        <Row label={t("Limiter")}>
          <Toggle checked={!!project.master?.limiter} onChange={(v) => commit(t("Limiter"), (d) => void (d.master = { volume: d.master?.volume ?? 1, limiter: v }))} label={t("Prevent clipping")} />
        </Row>
        <Row label={t("Contents")}>
          <span className="text-muted">{t("{{m}} media · {{c}} clips · {{t}} tracks", { m: project.media.length, c: clips.length, t: project.tracks.length })}</span>
        </Row>
        <Button className="w-full" onClick={() => useAppDialog("projectSettings")}>
          {t("Project settings")}
        </Button>
      </Section>
      <p className="p-3 text-[12px] leading-relaxed text-dim">{t("Select a clip on the timeline to edit its properties, or a media item to see its details.")}</p>
    </div>
  );
}

const useAppDialog = (d: "projectSettings") => useApp.getState().openDialog(d);

export default function Inspector() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const selection = useUi((s) => s.selection);
  const mediaId = useUi((s) => s.selectedMediaId);
  const clips = selection.map((id) => project.clips[id]).filter(Boolean);
  let body: ReactNode;
  if (clips.length === 1 && isMediaClip(clips[0])) body = <MediaClipInspector key={clips[0].id} clip={clips[0]} project={project} />;
  else if (clips.length === 1 && isTextClip(clips[0])) body = <TextClipInspector key={clips[0].id} clip={clips[0]} />;
  else if (clips.length > 1)
    body = (
      <Section title={t("{{n}} clips selected", { n: clips.length })}>
        <Row label={t("Opacity")}>
          <Slider
            value={clips[0].type === "media" ? clips[0].opacity : (clips[0] as TextClip).opacity}
            min={0}
            max={1}
            step={0.01}
            display={(v) => v * 100}
            precision={0}
            suffix="%"
            onChange={(v) => useProject.getState().commit(t("Opacity"), (d) => selection.forEach((id) => d.clips[id] && (d.clips[id].opacity = v)), "multi-op")}
          />
        </Row>
        <Button variant="ghost" className="w-full text-red-300" onClick={() => deleteSelection(false)}>
          <Trash2 size={14} />
          {t("Delete clips")}
        </Button>
      </Section>
    );
  else if (mediaId) body = <MediaInfo id={mediaId} />;
  else body = <ProjectInfo />;
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Properties")}</div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  );
}
