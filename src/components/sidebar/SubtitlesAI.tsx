import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Captions, Download, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { errorText } from "../../backend/api";
import { addSubtitleTrack, cancelAiJob, downloadModel, recommendedModel, refreshAiStatus, transcribeClip, useAi, WHISPER_MODELS } from "../../services/ai";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { isMediaClip, type MediaClip } from "../../types/project";
import { Button, ProgressBar, Row, Section, Select, Toggle } from "../common/ui";

export const LANGUAGES = [
  { value: "auto", label: "Auto-detect" },
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "tr", label: "Türkçe" },
  { value: "ur", label: "اردو" },
  { value: "fa", label: "فارسی" },
  { value: "hi", label: "हिन्दी" },
];

/** AI panel section: automatic subtitles with whisper.cpp (local). */
export default function SubtitlesAI() {
  const { t } = useTranslation();
  const status = useAi((s) => s.status);
  const jobs = useAi((s) => s.jobs);
  const system = useApp((s) => s.system);
  const project = useProject((s) => s.project)!;
  const selection = useUi((s) => s.selection);
  const [lang, setLang] = useState("ar");
  const [translate, setTranslate] = useState(false);
  const [maxLen, setMaxLen] = useState(42);
  const [model, setModel] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  useEffect(() => void refreshAiStatus(), []);

  const installed = WHISPER_MODELS.filter((m) => status?.models.some((f) => f.file === m.file));
  useEffect(() => {
    if (!model && installed.length) setModel((installed.find((m) => m.id === recommendedModel(system?.profile)) ?? installed[installed.length - 1]).file);
  }, [installed, model, system]);
  const sel = selection.map((id) => project.clips[id]).filter((c): c is MediaClip => isMediaClip(c));
  const target = sel.length === 1 ? sel[0] : null;
  const targetMedia = target ? project.media.find((m) => m.id === target.mediaId) : undefined;
  const rec = WHISPER_MODELS.find((m) => m.id === recommendedModel(system?.profile))!;
  const dlJob = Object.entries(jobs).find(([, j]) => j.kind === "download");
  const running = jobId ? jobs[jobId] : undefined;

  const generate = async () => {
    if (!target) return;
    try {
      const cues = await transcribeClip(target, { modelFile: model, language: lang, translate, maxLen }, setJobId);
      if (!cues.length) {
        useApp.getState().toast(t("No speech was recognised in this clip."));
        return;
      }
      addSubtitleTrack(cues);
      useApp.getState().toast(t("{{n}} subtitle lines added on a new track", { n: cues.length }), "success");
    } catch (e) {
      useApp.getState().toast(errorText(e), "error");
    } finally {
      setJobId(null);
    }
  };

  return (
    <Section title={t("Automatic subtitles")} right={<Captions size={14} className="text-dim" />}>
      {!status ? (
        <LoaderCircle size={14} className="animate-spin" />
      ) : !status.whisper ? (
        <p className="flex gap-2 text-[11.5px] text-amber-200">
          <TriangleAlert size={14} className="shrink-0" />
          {t("The speech recognition engine (whisper.cpp) was not found. It is included in the installer; for development builds set its folder in Settings → AI models.")}
        </p>
      ) : installed.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[11.5px] text-muted">{t("Download a speech model once (stored on this computer, works offline afterwards).")}</p>
          {dlJob ? (
            <div>
              <ProgressBar value={dlJob[1].progress} />
              <div className="mt-1 flex justify-between text-[11px] text-dim">
                <span>{Math.round(dlJob[1].progress * 100)}%</span>
                <button onClick={() => cancelAiJob(dlJob[0])}>{t("Cancel")}</button>
              </div>
            </div>
          ) : (
            <Button className="w-full" onClick={() => downloadModel(rec)}>
              <Download size={14} />
              {t("Download “{{m}}” model ({{s}} MB)", { m: rec.id, s: rec.sizeMb })}
            </Button>
          )}
        </div>
      ) : (
        <>
          <Row label={t("Language")}>
            <Select value={lang} onChange={setLang} options={LANGUAGES.map((l) => ({ value: l.value, label: l.value === "auto" ? t(l.label) : l.label }))} />
          </Row>
          <Row label={t("Model")}>
            <Select value={model} onChange={setModel} options={installed.map((m) => ({ value: m.file, label: `${m.id} (${m.sizeMb} MB)` }))} />
          </Row>
          <Row label={t("Line length")}>
            <Select value={maxLen} onChange={setMaxLen} options={[24, 32, 42, 60, 0].map((n) => ({ value: n, label: n ? t("{{n}} characters", { n }) : t("Whole sentences") }))} />
          </Row>
          <Row label={t("Translate")}>
            <Toggle checked={translate} onChange={setTranslate} label={t("Translate to English")} />
          </Row>
          {running ? (
            <div>
              <ProgressBar value={running.progress} />
              <div className="mt-1 flex items-center justify-between text-[11px] text-dim">
                <span className="flex items-center gap-1.5">
                  <LoaderCircle size={12} className="animate-spin" />
                  {t("Transcribing locally…")} {Math.round(running.progress * 100)}%
                </span>
                <button className="flex items-center gap-1 hover:text-fg" onClick={() => jobId && cancelAiJob(jobId)}>
                  <X size={12} />
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <Button variant="primary" className="w-full" disabled={!target || !targetMedia?.hasAudio || !model} onClick={generate}>
              <Captions size={14} />
              {t("Generate subtitles")}
            </Button>
          )}
          {!target && <p className="text-[11px] text-dim">{t("Select one video or audio clip with speech.")}</p>}
        </>
      )}
    </Section>
  );
}
