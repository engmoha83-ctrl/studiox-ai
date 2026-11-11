import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CircleCheck, Download, FolderOpen, Trash2, TriangleAlert, X } from "lucide-react";
import { api, errorText } from "../../backend/api";
import { formatBytes } from "../../lib/time";
import { cancelAiJob, downloadModel, recommendedModel, refreshAiStatus, useAi, WHISPER_MODELS } from "../../services/ai";
import { useApp } from "../../store/appStore";
import { Button, IconBtn, ProgressBar, Section, confirmAction, cx } from "../common/ui";

/** Settings → local AI model manager. */
export default function AiModels() {
  const { t } = useTranslation();
  const status = useAi((s) => s.status);
  const jobs = useAi((s) => s.jobs);
  const system = useApp((s) => s.system);
  useEffect(() => void refreshAiStatus(), []);
  const rec = recommendedModel(system?.profile);
  const used = status?.models.reduce((a, m) => a + m.size, 0) ?? 0;
  return (
    <Section title={t("AI models (local)")}>
      <div className="flex items-start gap-2 text-[12px]">
        {status?.whisper ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-emerald-400" /> : <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />}
        <div className="min-w-0 flex-1">
          <div>{t("Speech recognition engine")}: whisper.cpp</div>
          <div className="truncate text-dim" dir="ltr">
            {status?.whisper ?? t("not found")}
          </div>
        </div>
        <IconBtn
          tip={t("Choose whisper.cpp folder…")}
          onClick={async () => {
            const d = await openDialog({ directory: true });
            if (typeof d !== "string") return;
            try {
              await api.aiSetWhisperDir(d);
              await refreshAiStatus();
            } catch (e) {
              useApp.getState().toast(errorText(e), "error");
            }
          }}
        >
          <FolderOpen size={14} />
        </IconBtn>
      </div>
      <div className="space-y-1.5">
        {WHISPER_MODELS.map((m) => {
          const file = status?.models.find((f) => f.file === m.file);
          const job = Object.entries(jobs).find(([, j]) => j.kind === "download" && j.label === m.file);
          const tooBig = system && system.ramMb < m.ramMb;
          return (
            <div key={m.id} className={cx("rounded-md border px-3 py-2", m.id === rec ? "border-accent/50" : "border-line")}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">
                    {m.id} <span className="text-dim">· {m.sizeMb >= 1000 ? `${(m.sizeMb / 1000).toFixed(1)} GB` : `${m.sizeMb} MB`}</span>
                    {m.id === rec && <span className="ms-2 rounded bg-accent/20 px-1.5 text-[10.5px] text-violet-200">{t("Recommended for this PC")}</span>}
                  </div>
                  <div className="text-[11px] text-dim">
                    {t(m.quality)}
                    {tooBig && <span className="text-amber-300"> · {t("may be too heavy for this computer's memory")}</span>}
                  </div>
                </div>
                {file ? (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!(await confirmAction(t("Delete model"), t("Delete {{m}} ({{s}}) from this computer?", { m: m.id, s: formatBytes(file.size) }), true))) return;
                      await api.aiDeleteModel(m.file);
                      await refreshAiStatus();
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                ) : job ? (
                  <IconBtn tip={t("Cancel")} onClick={() => cancelAiJob(job[0])}>
                    <X size={14} />
                  </IconBtn>
                ) : (
                  <Button onClick={() => downloadModel(m)}>
                    <Download size={13} />
                    {t("Download")}
                  </Button>
                )}
              </div>
              {job && <ProgressBar value={job[1].progress} className="mt-2" />}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-dim">
        {t("Models are downloaded once from the whisper.cpp project (Hugging Face) and run entirely on this computer. Storage used: {{s}}.", { s: formatBytes(used) })}
      </p>
      <p className="text-[11px] text-dim">
        {t("AI assistant (optional)")}: {status?.ollama ? `Ollama ✓ (${status.ollama.length} ${t("models")})` : t("Ollama not detected (optional, lets the AI assistant understand free-form requests).")}
      </p>
    </Section>
  );
}
