import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Crop, LoaderCircle, ScanSearch, X } from "lucide-react";
import { errorText } from "../../backend/api";
import { REFRAME_ASPECTS, type Aspect } from "../../engine/reframe";
import { applyReframe, planReframe, type ReframePlan } from "../../services/reframe";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { Button, Row, Section, Select } from "../common/ui";

/** Smart reframe: new aspect ratio, subject kept in frame by motion/detail tracking. */
export default function ReframeAI() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const toast = useApp((s) => s.toast);
  const [aspect, setAspect] = useState<Aspect["id"]>("9:16");
  const [progress, setProgress] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReframePlan | null>(null);
  const a = REFRAME_ASPECTS.find((x) => x.id === aspect)!;
  const same = Math.abs(project.settings.width / project.settings.height - a.w / a.h) < 0.01;

  const analyse = async () => {
    setPlan(null);
    setProgress(t("Analysing…"));
    try {
      setPlan(await planReframe(a, (d, n, sub) => setProgress(t("Tracking the subject… {{d}}/{{n}}", { d: Math.min(n, d + 1), n }) + (sub !== undefined ? ` ${Math.round(sub * 100)}%` : ""))));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setProgress(null);
    }
  };

  const apply = () => {
    if (!plan) return;
    applyReframe(plan);
    toast(t("Reframed to {{w}}×{{h}}", { w: plan.width, h: plan.height }), "success");
    setPlan(null);
  };

  const n = plan ? Object.keys(plan.results).length : 0;
  return (
    <Section title={t("Smart reframe")} right={<Crop size={14} className="text-dim" />}>
      <Row label={t("New format")}>
        <Select value={aspect} onChange={(v) => { setAspect(v); setPlan(null); }} options={REFRAME_ASPECTS.map((x) => ({ value: x.id, label: t(x.name) }))} />
      </Row>
      <Button className="w-full" testId="reframe-analyse" disabled={!!progress || same || !Object.keys(project.clips).length} onClick={analyse}>
        {progress ? <LoaderCircle size={14} className="animate-spin" /> : <ScanSearch size={14} />}
        {progress ?? (same ? t("The project already has this format") : t("Analyse and suggest"))}
      </Button>
      <p className="text-[10.5px] text-dim">{t("Keeps the main person's face in frame (detected on this computer); shots without people follow motion and detail. Clips you already moved or scaled are left as they are.")}</p>
      {plan && (
        <div className="anim-in rounded-lg border border-accent/40 bg-accent/10 p-2.5" data-testid="reframe-plan">
          <div className="mb-1 font-semibold">{t("Suggested change")}</div>
          <p className="text-[12px] text-muted">
            {t("Canvas {{w0}}×{{h0}} → {{w}}×{{h}}. {{n}} clips will fill the frame and pan to follow the action ({{k}} with tracked movement).", {
              w0: project.settings.width,
              h0: project.settings.height,
              w: plan.width,
              h: plan.height,
              n,
              k: plan.tracked,
            })}
          </p>
          {plan.faces > 0 && <p className="mt-1 text-[11px] text-teal-100">{t("{{n}} clips framed on a detected face", { n: plan.faces })}</p>}
          {plan.skipped.length > 0 && <p className="mt-1 text-[11px] text-amber-200">{t("{{n}} positioned clips left as they were", { n: plan.skipped.length })}</p>}
          <div className="mt-2.5 flex gap-2">
            <Button variant="primary" className="flex-1" testId="reframe-apply" onClick={apply}>
              <Check size={14} />
              {t("Apply")}
            </Button>
            <Button variant="ghost" onClick={() => setPlan(null)}>
              <X size={14} />
              {t("Discard")}
            </Button>
          </div>
          <p className="mt-1.5 text-[10.5px] text-dim">{t("Original media is never modified. You can undo this step.")}</p>
        </div>
      )}
    </Section>
  );
}
