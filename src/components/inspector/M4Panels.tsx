// Milestone 4 inspector panels: keyframes, colour, effects, chroma key, mask, audio effects.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, ChevronRight, Diamond, FileUp, RotateCcw, X } from "lucide-react";
import { api, errorText } from "../../backend/api";
import { COLOR_PRESETS, curveFn, defaultColor, parseCube } from "../../engine/color";
import { baseValue, evalKf, setKeyframe } from "../../engine/keyframes";
import { uid } from "../../lib/id";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { player } from "../../preview/player";
import type { AudioFx, ColorParams, CurvePoint, Easing, EffectType, KfProp, MediaClip } from "../../types/project";
import { Button, IconBtn, Row, Section, Select, Slider, Toggle, cx } from "../common/ui";

const EPS_T = 1 / 120;

function editClip(id: string, label: string, key: string, f: (c: MediaClip) => void) {
  useProject.getState().commit(
    label,
    (d) => {
      const c = d.clips[id];
      if (c && c.type === "media") f(c);
    },
    `${key}:${id}`,
  );
}

// ------------------------------------------------------------------ keyframes

export function useLocalTime(c: MediaClip) {
  const ph = useUi((s) => s.playhead);
  return Math.min(c.duration, Math.max(0, ph - c.start));
}

/** Current (possibly animated) value of a property. */
export function propValue(c: MediaClip, p: KfProp, local: number) {
  return evalKf(c.keyframes?.[p], local, baseValue(c, p));
}

function setBase(c: MediaClip, p: KfProp, v: number) {
  if (p === "x") c.transform.x = v;
  else if (p === "y") c.transform.y = v;
  else if (p === "scale") c.transform.scale = v;
  else if (p === "rotation") c.transform.rotation = v;
  else if (p === "opacity") c.opacity = v;
  else c.volume = v;
}

/** Set a property: writes a keyframe at the playhead if the property is animated, else the static value. */
export function setProp(c: MediaClip, p: KfProp, v: number, label: string) {
  const local = Math.min(c.duration, Math.max(0, useUi.getState().playhead - c.start));
  editClip(c.id, label, `kf-${p}`, (d) => {
    const list = d.keyframes?.[p];
    if (list?.length) {
      const existing = list.find((k) => Math.abs(k.t - local) < EPS_T);
      d.keyframes![p] = setKeyframe(list, existing ? existing.t : local, v, existing?.ease ?? "ease-in-out");
    } else setBase(d, p, v);
  });
}

export function KfButton({ clip, prop }: { clip: MediaClip; prop: KfProp }) {
  const { t } = useTranslation();
  const local = useLocalTime(clip);
  const list = clip.keyframes?.[prop] ?? [];
  const at = list.find((k) => Math.abs(k.t - local) < EPS_T);
  const prev = [...list].reverse().find((k) => k.t < local - EPS_T);
  const next = list.find((k) => k.t > local + EPS_T);
  const toggle = () =>
    editClip(clip.id, t("Keyframe"), `kft-${prop}-${Date.now()}`, (d) => {
      d.keyframes ??= {};
      const cur = d.keyframes[prop] ?? [];
      if (at) d.keyframes[prop] = cur.filter((k) => Math.abs(k.t - at.t) >= EPS_T);
      else d.keyframes[prop] = setKeyframe(cur, local, evalKf(cur, local, baseValue(d, prop)));
      if (!d.keyframes[prop]!.length) {
        // removing the last keyframe keeps the value it had
        setBase(d, prop, evalKf(cur, local, baseValue(d, prop)));
        delete d.keyframes[prop];
      }
    });
  return (
    <span className="flex shrink-0 items-center">
      {list.length > 0 && (
        <button className="text-dim hover:text-fg disabled:opacity-20" disabled={!prev} onClick={() => prev && player.seek(clip.start + prev.t)} title={t("Previous keyframe")}>
          <ChevronLeft size={12} />
        </button>
      )}
      <button onClick={toggle} title={at ? t("Remove keyframe") : t("Add keyframe at playhead")} className={cx("rounded p-0.5", at ? "text-amber-300" : list.length ? "text-amber-300/60" : "text-dim hover:text-fg")}>
        <Diamond size={12} fill={at ? "currentColor" : "none"} />
      </button>
      {list.length > 0 && (
        <button className="text-dim hover:text-fg disabled:opacity-20" disabled={!next} onClick={() => next && player.seek(clip.start + next.t)} title={t("Next keyframe")}>
          <ChevronRight size={12} />
        </button>
      )}
    </span>
  );
}

export function EasingRow({ clip }: { clip: MediaClip }) {
  const { t } = useTranslation();
  const local = useLocalTime(clip);
  const props = Object.entries(clip.keyframes ?? {}).filter(([, l]) => l?.some((k) => Math.abs(k.t - local) < EPS_T)) as [KfProp, NonNullable<MediaClip["keyframes"]>[KfProp]][];
  if (!props.length) return null;
  const cur = props[0][1]!.find((k) => Math.abs(k.t - local) < EPS_T)!.ease;
  return (
    <Row label={t("Easing")}>
      <Select
        value={cur}
        onChange={(e: Easing) =>
          editClip(clip.id, t("Easing"), "ease", (d) => {
            for (const [p] of props) for (const k of d.keyframes![p]!) if (Math.abs(k.t - local) < EPS_T) k.ease = e;
          })
        }
        options={(["linear", "ease-in", "ease-out", "ease-in-out", "hold"] as Easing[]).map((e) => ({ value: e, label: t(easingName[e]) }))}
      />
    </Row>
  );
}
const easingName: Record<Easing, string> = { linear: "Linear", "ease-in": "Ease in", "ease-out": "Ease out", "ease-in-out": "Ease in-out", hold: "Hold" };

// ------------------------------------------------------------------ colour

function CurveEditor({ points, onChange }: { points: CurvePoint[]; onChange: (p: CurvePoint[]) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const S = 168;
  const fn = curveFn(points);
  const path = Array.from({ length: 41 }, (_, i) => {
    const x = i / 40;
    return `${i ? "L" : "M"}${(x * S).toFixed(1)},${((1 - Math.min(1, Math.max(0, fn(x)))) * S).toFixed(1)}`;
  }).join(" ");
  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) };
  };
  const drag = (i: number, list: CurvePoint[]) => {
    const move = (ev: PointerEvent) => {
      const p = toPt(ev);
      const next = list.map((q, j) => (j === i ? p : q)).sort((a, b) => a.x - b.x);
      onChange(next);
      list = next;
      i = next.indexOf(p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${S} ${S}`}
      className="w-full rounded-md border border-line-2 bg-panel-2"
      style={{ aspectRatio: "1" }}
      onPointerDown={(e) => {
        if ((e.target as Element).tagName === "circle") return;
        const p = toPt(e);
        const next = [...points, p].sort((a, b) => a.x - b.x);
        onChange(next);
        drag(next.indexOf(p), next);
      }}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} stroke="#2e3546" strokeWidth="0.6">
          <line x1={g * S} x2={g * S} y1={0} y2={S} />
          <line y1={g * S} y2={g * S} x1={0} x2={S} />
        </g>
      ))}
      <line x1={0} y1={S} x2={S} y2={0} stroke="#3b4252" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="#c4b5fd" strokeWidth="1.6" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x * S}
          cy={(1 - p.y) * S}
          r={4.5}
          fill="#fff"
          stroke="#7c3aed"
          className="cursor-move"
          onPointerDown={(e) => {
            e.stopPropagation();
            drag(i, points);
          }}
          onDoubleClick={() => onChange(points.filter((_, j) => j !== i))}
        />
      ))}
    </svg>
  );
}

export function ColorPanel({ clip }: { clip: MediaClip }) {
  const { t } = useTranslation();
  const c = clip.color ?? defaultColor();
  const [ch, setCh] = useState<"master" | "r" | "g" | "b">("master");
  const set = (label: string, key: string, f: (p: ColorParams) => void) =>
    editClip(clip.id, label, `col-${key}`, (d) => {
      d.color ??= defaultColor();
      f(d.color);
    });
  const slider = (k: keyof ColorParams, label: string, min: number, max: number, step = 0.01) => (
    <Row key={k} label={t(label)}>
      <Slider value={c[k] as number} min={min} max={max} step={step} precision={2} onChange={(v) => set(t(label), k, (p) => void ((p[k] as number) = v))} />
    </Row>
  );
  const importLut = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "3D LUT", extensions: ["cube"] }] });
    if (typeof f !== "string") return;
    try {
      parseCube(await api.readTextFile(f)); // validate
      set(t("Import LUT"), "lut", (p) => {
        p.lutPath = f;
        p.lutIntensity = 1;
      });
    } catch (e) {
      useApp.getState().toast(errorText(e), "error");
    }
  };
  return (
    <>
      <Section
        title={t("Presets")}
        right={
          <IconBtn tip={t("Reset colour")} onClick={() => editClip(clip.id, t("Reset colour"), "colreset" + Date.now(), (d) => void (d.color = null))}>
            <RotateCcw size={13} />
          </IconBtn>
        }
      >
        <div className="grid grid-cols-3 gap-1.5">
          {COLOR_PRESETS.map((pr) => (
            <button
              key={pr.id}
              onClick={() => editClip(clip.id, t("Colour preset"), "preset" + Date.now(), (d) => void (d.color = { ...defaultColor(), ...pr.params, lutPath: d.color?.lutPath ?? null, lutIntensity: d.color?.lutIntensity ?? 1 }))}
              className="rounded-md border border-line-2 px-1.5 py-1.5 text-[11px] hover:border-accent hover:bg-accent/10"
            >
              {t(pr.name)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("Light")}>
        {slider("exposure", "Exposure", -3, 3)}
        {slider("contrast", "Contrast", -1, 1)}
        {slider("highlights", "Highlights", -1, 1)}
        {slider("shadows", "Shadows", -1, 1)}
        {slider("whites", "Whites", -1, 1)}
        {slider("blacks", "Blacks", -1, 1)}
      </Section>
      <Section title={t("Colour")}>
        {slider("temperature", "Temperature", -1, 1)}
        {slider("tint", "Tint", -1, 1)}
        {slider("saturation", "Saturation", -1, 1)}
        {slider("vibrance", "Vibrance", -1, 1)}
        {slider("hue", "Hue", -180, 180, 1)}
      </Section>
      <Section title={t("Colour wheels")}>
        {(["lift", "gamma", "gain"] as const).map((w) => (
          <div key={w}>
            <div className="mb-1 text-[11.5px] text-muted">{t(w === "lift" ? "Shadows (lift)" : w === "gamma" ? "Midtones (gamma)" : "Highlights (gain)")}</div>
            {(["R", "G", "B"] as const).map((L, i) => (
              <div key={L} className="flex items-center gap-2">
                <span className={cx("w-3 text-[11px] font-semibold", i === 0 ? "text-red-400" : i === 1 ? "text-green-400" : "text-blue-400")}>{L}</span>
                <Slider value={c[w][i]} min={-1} max={1} step={0.01} onChange={(v) => set(t("Colour wheels"), `${w}${i}`, (p) => void (p[w][i] = v))} />
              </div>
            ))}
          </div>
        ))}
      </Section>
      <Section
        title={t("Curves")}
        right={
          <div className="flex gap-0.5">
            {(["master", "r", "g", "b"] as const).map((k) => (
              <button key={k} onClick={() => setCh(k)} className={cx("rounded px-1.5 text-[11px]", ch === k ? "bg-accent/25 text-fg" : "text-muted")}>
                {k === "master" ? "RGB" : k.toUpperCase()}
              </button>
            ))}
          </div>
        }
      >
        <CurveEditor points={c.curves[ch]} onChange={(pts) => set(t("Curves"), `curve-${ch}`, (p) => void (p.curves[ch] = pts))} />
        <p className="text-[11px] text-dim">{t("Click to add a point, drag to move, double-click to remove.")}</p>
      </Section>
      <Section title={t("LUT")}>
        {c.lutPath ? (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px]" dir="ltr" title={c.lutPath}>
                {c.lutPath.split(/[\\/]/).pop()}
              </span>
              <IconBtn tip={t("Remove LUT")} onClick={() => set(t("Remove LUT"), "lutrm", (p) => void (p.lutPath = null))}>
                <X size={13} />
              </IconBtn>
            </div>
            <Row label={t("Intensity")}>
              <Slider value={c.lutIntensity} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => set(t("LUT intensity"), "luti", (p) => void (p.lutIntensity = v))} />
            </Row>
          </>
        ) : (
          <Button className="w-full" onClick={importLut}>
            <FileUp size={14} />
            {t("Import .cube LUT…")}
          </Button>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ effects, chroma key, mask

const EFFECTS: { type: EffectType; name: string; def: number }[] = [
  { type: "blur", name: "Blur", def: 0.15 },
  { type: "sharpen", name: "Sharpen", def: 0.4 },
  { type: "vignette", name: "Vignette", def: 0.6 },
  { type: "grain", name: "Film grain", def: 0.3 },
  { type: "letterbox", name: "Cinematic bars", def: 0.25 },
];

export function EffectsPanel({ clip }: { clip: MediaClip }) {
  const { t } = useTranslation();
  const ck = clip.chromaKey;
  const mask = clip.mask;
  return (
    <>
      <Section title={t("Effects")}>
        {EFFECTS.map((def) => {
          const e = clip.effects?.find((x) => x.type === def.type);
          return (
            <div key={def.type} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px]">{t(def.name)}</span>
                <Toggle
                  checked={!!e?.enabled}
                  onChange={(on) =>
                    editClip(clip.id, t(def.name), `fx-${def.type}-${Date.now()}`, (d) => {
                      d.effects ??= [];
                      const x = d.effects.find((y) => y.type === def.type);
                      if (x) x.enabled = on;
                      else d.effects.push({ id: uid("fx"), type: def.type, enabled: on, amount: def.def });
                    })
                  }
                />
              </div>
              {e?.enabled && (
                <Slider value={e.amount} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={(v) => editClip(clip.id, t(def.name), `fxa-${def.type}`, (d) => void (d.effects!.find((y) => y.type === def.type)!.amount = v))} />
              )}
            </div>
          );
        })}
      </Section>
      <Section title={t("Chroma key (green screen)")}>
        <Row label={t("Enabled")}>
          <Toggle
            checked={!!ck?.enabled}
            onChange={(on) => editClip(clip.id, t("Chroma key"), "ck" + Date.now(), (d) => void (d.chromaKey = { color: "#00ff00", similarity: 0.15, blend: 0.08, ...(d.chromaKey ?? {}), enabled: on }))}
          />
        </Row>
        {ck?.enabled && (
          <>
            <Row label={t("Key colour")}>
              <input type="color" value={ck.color} onChange={(e) => editClip(clip.id, t("Chroma key"), "ckc", (d) => void (d.chromaKey!.color = e.target.value))} />
              <div className="flex gap-1">
                {["#00ff00", "#0047bb", "#00b140"].map((col) => (
                  <button key={col} className="size-5 rounded border border-line-2" style={{ background: col }} onClick={() => editClip(clip.id, t("Chroma key"), "ckc" + Date.now(), (d) => void (d.chromaKey!.color = col))} />
                ))}
              </div>
            </Row>
            <Row label={t("Similarity")}>
              <Slider value={ck.similarity} min={0.01} max={0.6} step={0.005} precision={3} onChange={(v) => editClip(clip.id, t("Chroma key"), "cks", (d) => void (d.chromaKey!.similarity = v))} />
            </Row>
            <Row label={t("Edge softness")}>
              <Slider value={ck.blend} min={0} max={0.5} step={0.005} precision={3} onChange={(v) => editClip(clip.id, t("Chroma key"), "ckb", (d) => void (d.chromaKey!.blend = v))} />
            </Row>
          </>
        )}
      </Section>
      <Section title={t("Mask")}>
        <Row label={t("Shape")}>
          <Select
            value={mask?.shape ?? "none"}
            onChange={(v) =>
              editClip(clip.id, t("Mask"), "mshape" + Date.now(), (d) => void (d.mask = v === "none" ? null : { x: 0.5, y: 0.5, w: 0.6, h: 0.6, feather: 0.05, invert: false, ...(d.mask ?? {}), shape: v as "rectangle" | "ellipse" }))
            }
            options={[
              { value: "none", label: t("None") },
              { value: "rectangle", label: t("Rectangle") },
              { value: "ellipse", label: t("Ellipse") },
            ]}
          />
        </Row>
        {mask && (
          <>
            {(
              [
                ["x", "Centre X"],
                ["y", "Centre Y"],
                ["w", "Width"],
                ["h", "Height"],
              ] as const
            ).map(([k, label]) => (
              <Row key={k} label={t(label)}>
                <Slider value={mask[k]} min={k === "w" || k === "h" ? 0.02 : 0} max={k === "w" || k === "h" ? 1.5 : 1} step={0.005} display={(v) => v * 100} precision={1} suffix="%" onChange={(v) => editClip(clip.id, t("Mask"), `m${k}`, (d) => void (d.mask![k] = v))} />
              </Row>
            ))}
            <Row label={t("Feather")}>
              <Slider value={mask.feather} min={0} max={0.5} step={0.005} display={(v) => v * 100} precision={1} suffix="%" onChange={(v) => editClip(clip.id, t("Mask"), "mf", (d) => void (d.mask!.feather = v))} />
            </Row>
            <Row label={t("Invert")}>
              <Toggle checked={mask.invert} onChange={(v) => editClip(clip.id, t("Mask"), "mi" + Date.now(), (d) => void (d.mask!.invert = v))} />
            </Row>
          </>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ audio effects

const DEFAULT_FX: AudioFx = { eqLow: 0, eqMid: 0, eqHigh: 0, compressor: 0, noiseReduction: 0 };

export function AudioFxSection({ clip }: { clip: MediaClip }) {
  const { t } = useTranslation();
  const fx = clip.audioFx ?? DEFAULT_FX;
  const set = (k: keyof AudioFx, label: string) => (v: number) =>
    editClip(clip.id, t(label), `afx-${k}`, (d) => {
      d.audioFx ??= { ...DEFAULT_FX };
      d.audioFx[k] = v;
    });
  return (
    <Section
      title={t("Audio effects")}
      right={
        <IconBtn tip={t("Reset")} onClick={() => editClip(clip.id, t("Audio effects"), "afxr" + Date.now(), (d) => void (d.audioFx = null))}>
          <RotateCcw size={13} />
        </IconBtn>
      }
    >
      <Row label={t("Bass (100 Hz)")}>
        <Slider value={fx.eqLow} min={-12} max={12} step={0.5} precision={1} suffix="dB" onChange={set("eqLow", "Equalizer")} />
      </Row>
      <Row label={t("Mids (1 kHz)")}>
        <Slider value={fx.eqMid} min={-12} max={12} step={0.5} precision={1} suffix="dB" onChange={set("eqMid", "Equalizer")} />
      </Row>
      <Row label={t("Treble (8 kHz)")}>
        <Slider value={fx.eqHigh} min={-12} max={12} step={0.5} precision={1} suffix="dB" onChange={set("eqHigh", "Equalizer")} />
      </Row>
      <Row label={t("Compressor")}>
        <Slider value={fx.compressor} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={set("compressor", "Compressor")} />
      </Row>
      <Row label={t("Noise reduction")}>
        <Slider value={fx.noiseReduction} min={0} max={1} step={0.01} display={(v) => v * 100} precision={0} suffix="%" onChange={set("noiseReduction", "Noise reduction")} />
      </Row>
      <p className="text-[11px] text-dim">{t("Audio effects are rendered in the export; the preview plays the clip without them.")}</p>
    </Section>
  );
}
