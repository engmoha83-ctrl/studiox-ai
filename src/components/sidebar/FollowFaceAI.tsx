import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle, ScanFace, X } from "lucide-react";
import { errorText } from "../../backend/api";
import { applyFollow, baseClipFor, planFollow, type FollowPlan } from "../../services/follow";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { isMediaClip } from "../../types/project";
import { Button, Section, Toggle } from "../common/ui";

/** Make the selected overlay follow the main face of the video below it. */
export default function FollowFaceAI() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const selection = useUi((s) => s.selection);
  const toast = useApp((s) => s.toast);
  const [withScale, setWithScale] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [plan, setPlan] = useState<FollowPlan | null>(null);
  const clip = selection.length === 1 ? project.clips[selection[0]] : undefined;
  const overlay = isMediaClip(clip) ? clip : null;
  const base = overlay ? baseClipFor(project, overlay) : null;

  const run = async () => {
    if (!overlay) return;
    setPlan(null);
    setProgress(0);
    try {
      setPlan(await planFollow(overlay.id, withScale, setProgress));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Section title={t("Follow a face")} right={<ScanFace size={14} className="text-dim" />}>
      <p className="text-[11px] text-muted">{t("Select a sticker, logo or picture-in-picture clip placed over a video. It will move with the person's face (you can keep its offset, e.g. above the head).")}</p>
      <Toggle checked={withScale} onChange={setWithScale} label={t("Also scale with the face")} />
      <Button className="w-full" testId="follow-run" disabled={!overlay || !base || progress !== null} onClick={run}>
        {progress !== null ? <LoaderCircle size={14} className="animate-spin" /> : <ScanFace size={14} />}
        {progress !== null ? `${t("Detecting faces…")} ${Math.round(progress * 100)}%` : t("Track the face")}
      </Button>
      {overlay && !base && <p className="text-[11px] text-amber-200">{t("There is no video under this clip to track.")}</p>}
      {plan && (
        <div className="anim-in rounded-lg border border-accent/40 bg-accent/10 p-2.5" data-testid="follow-plan">
          <p className="text-[12px] text-muted">
            {t("Face found in {{f}} of {{n}} analysed frames. The clip gets {{k}} position keyframes.", { f: plan.result.found, n: plan.frames, k: plan.result.x.length + plan.result.y.length })}
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              testId="follow-apply"
              onClick={() => {
                applyFollow(plan);
                setPlan(null);
                toast(t("The clip now follows the face"), "success");
              }}
            >
              <Check size={14} />
              {t("Apply")}
            </Button>
            <Button variant="ghost" onClick={() => setPlan(null)}>
              <X size={14} />
              {t("Discard")}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
