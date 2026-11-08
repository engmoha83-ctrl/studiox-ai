import { useState } from "react";
import { useTranslation } from "react-i18next";
import { applyTransition } from "../../editor/actions";
import { useUi } from "../../store/uiStore";
import type { TransitionType } from "../../types/project";
import { Button, NumberField, Row, Select } from "../common/ui";

export const TRANSITION_DND = "application/x-studiox-transition";

export const TRANSITIONS: { type: TransitionType; name: string; hint: string }[] = [
  { type: "fade", name: "Fade", hint: "Fades from / to black (or the layers below)." },
  { type: "dissolve", name: "Cross dissolve", hint: "Blends with the previous adjacent clip." },
  { type: "slide-left", name: "Slide left", hint: "Pushes in from the right over the previous clip." },
  { type: "slide-right", name: "Slide right", hint: "Pushes in from the left over the previous clip." },
  { type: "slide-up", name: "Slide up", hint: "Pushes in from the bottom." },
  { type: "slide-down", name: "Slide down", hint: "Pushes in from the top." },
];

function Thumb({ type }: { type: TransitionType }) {
  const anim: Record<TransitionType, string> = {
    fade: "sx-fade",
    dissolve: "sx-fade",
    "slide-left": "sx-sl",
    "slide-right": "sx-sr",
    "slide-up": "sx-su",
    "slide-down": "sx-sd",
  };
  return (
    <div className="relative aspect-video overflow-hidden rounded bg-gradient-to-br from-sky-700 to-indigo-900">
      <style>{`
        @keyframes sx-fade{0%,20%{opacity:0}60%,100%{opacity:1}}
        @keyframes sx-sl{0%,20%{transform:translateX(100%)}60%,100%{transform:none}}
        @keyframes sx-sr{0%,20%{transform:translateX(-100%)}60%,100%{transform:none}}
        @keyframes sx-su{0%,20%{transform:translateY(100%)}60%,100%{transform:none}}
        @keyframes sx-sd{0%,20%{transform:translateY(-100%)}60%,100%{transform:none}}
      `}</style>
      <div
        className="absolute inset-0 bg-gradient-to-br from-amber-500 to-rose-600"
        style={{ animation: `${anim[type]} 1.8s ease-in-out infinite alternate`, background: type === "fade" ? "linear-gradient(135deg,#f59e0b,#e11d48)" : undefined }}
      />
      {type === "fade" && <div className="absolute inset-0 bg-black" style={{ animation: "sx-fade 1.8s ease-in-out infinite alternate-reverse", opacity: 0.0 }} />}
    </div>
  );
}

export default function TransitionsPanel() {
  const { t } = useTranslation();
  const [edge, setEdge] = useState<"in" | "out" | "both">("in");
  const [dur, setDur] = useState(0.6);
  const selection = useUi((s) => s.selection);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line p-2.5">
        <Row label={t("Apply to")}>
          <Select
            value={edge}
            onChange={setEdge}
            options={[
              { value: "in", label: t("Clip start (in)") },
              { value: "out", label: t("Clip end (out)") },
              { value: "both", label: t("Both ends") },
            ]}
          />
        </Row>
        <Row label={t("Duration")}>
          <NumberField value={dur} onChange={setDur} min={0.1} max={5} step={0.05} suffix="s" />
        </Row>
        <div className="flex gap-1.5">
          <Button className="flex-1" disabled={!selection.length} onClick={() => applyTransition(null, edge)}>
            {t("Remove transitions")}
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-dim">{selection.length ? t("Click a transition to apply it to the {{count}} selected clip(s), or drag it onto a clip edge.", { count: selection.length }) : t("Select clips on the timeline, or drag a transition onto a clip edge.")}</p>
      </div>
      <div className="grid flex-1 content-start gap-2 overflow-auto p-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))" }}>
        {TRANSITIONS.map((tr) => (
          <button
            key={tr.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TRANSITION_DND, JSON.stringify({ type: tr.type, duration: dur }));
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => applyTransition(tr.type, edge, dur)}
            className="rounded-md border border-line p-1.5 text-start hover:border-accent"
            title={t(tr.hint)}
          >
            <Thumb type={tr.type} />
            <div className="mt-1 text-[11.5px]">{t(tr.name)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
