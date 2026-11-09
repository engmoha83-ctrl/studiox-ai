// Local AI services: model manager (whisper.cpp models), transcription → subtitles, SRT/VTT.
import { create } from "zustand";
import { api, errorText, onAiDone, onAiError, onAiProgress, type AiStatus } from "../backend/api";
import { cueClips, cuesFromWhisper, type Cue } from "../engine/subtitles";
import * as ops from "../engine/timelineOps";
import { uid } from "../lib/id";
import { app } from "../store/appStore";
import { commit, getProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";
import type { MediaClip, Track } from "../types/project";
import i18n from "../i18n";

export interface ModelDef {
  id: string;
  file: string;
  sizeMb: number;
  quality: string;
  /** minimum suggested RAM (MB) */
  ramMb: number;
}

/** whisper.cpp ggml models (MIT licence) hosted by the whisper.cpp project on Hugging Face. */
export const WHISPER_MODELS: ModelDef[] = [
  { id: "tiny", file: "ggml-tiny.bin", sizeMb: 75, quality: "Fastest, lowest accuracy", ramMb: 1000 },
  { id: "base", file: "ggml-base.bin", sizeMb: 142, quality: "Fast, basic accuracy", ramMb: 1500 },
  { id: "small", file: "ggml-small.bin", sizeMb: 466, quality: "Good accuracy (recommended for Arabic on most PCs)", ramMb: 2500 },
  { id: "medium", file: "ggml-medium.bin", sizeMb: 1530, quality: "High accuracy, slow on CPU", ramMb: 5000 },
  { id: "large-v3-turbo", file: "ggml-large-v3-turbo.bin", sizeMb: 1620, quality: "Best accuracy, needs a strong PC", ramMb: 6000 },
];
export const modelUrl = (m: ModelDef) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`;

export function recommendedModel(profile?: string): string {
  return profile === "high" ? "large-v3-turbo" : profile === "low" ? "base" : "small";
}

interface AiJob {
  kind: "download" | "transcribe";
  label: string;
  progress: number;
  resolve?: (out: string) => void;
  reject?: (e: Error) => void;
}

interface AiStore {
  status?: AiStatus;
  jobs: Record<string, AiJob>;
}
export const useAi = create<AiStore>(() => ({ jobs: {} }));

const setJob = (id: string, p: Partial<AiJob> | null) =>
  useAi.setState((s) => {
    const jobs = { ...s.jobs };
    if (p === null) delete jobs[id];
    else jobs[id] = { ...(jobs[id] ?? { kind: "download", label: "", progress: 0 }), ...p } as AiJob;
    return { jobs };
  });

let wired = false;
export function wireAiEvents() {
  if (wired) return;
  wired = true;
  void onAiProgress((p) => useAi.getState().jobs[p.id] && setJob(p.id, { progress: p.progress }));
  void onAiDone((e) => {
    const j = useAi.getState().jobs[e.id];
    setJob(e.id, null);
    j?.resolve?.(e.output ?? "");
    void refreshAiStatus();
  });
  void onAiError((e) => {
    const j = useAi.getState().jobs[e.id];
    setJob(e.id, null);
    j?.reject?.(new Error(e.message === "cancelled" ? i18n.t("Cancelled") : e.message ?? "error"));
  });
}

export async function refreshAiStatus() {
  try {
    useAi.setState({ status: await api.aiStatus() });
  } catch (e) {
    app().toast(errorText(e), "error");
  }
}

function run(kind: AiJob["kind"], label: string, start: (id: string) => Promise<void>): { id: string; done: Promise<string> } {
  wireAiEvents();
  const id = uid(kind);
  const done = new Promise<string>((resolve, reject) => setJob(id, { kind, label, progress: 0, resolve, reject }));
  start(id).catch((e) => {
    const j = useAi.getState().jobs[id];
    setJob(id, null);
    j?.reject?.(new Error(errorText(e)));
  });
  return { id, done };
}

export function downloadModel(m: ModelDef) {
  const job = run("download", m.file, (id) => api.aiDownloadModel(id, modelUrl(m), m.file));
  job.done.then(
    () => app().toast(i18n.t("Model downloaded: {{name}}", { name: m.id }), "success"),
    (e) => app().toast(`${m.id}: ${e.message}`, "error"),
  );
  return job;
}

export const cancelAiJob = (id: string) => void api.aiCancel(id);

export interface SubtitleOptions {
  modelFile: string;
  language: string; // "auto" | "ar" | "en" | ...
  translate: boolean;
  maxLen: number;
}

/** Transcribe the source range of a clip; returns cues in TIMELINE seconds. */
export async function transcribeClip(clip: MediaClip, opts: SubtitleOptions, onJob?: (id: string) => void): Promise<Cue[]> {
  const p = getProject()!;
  const m = p.media.find((x) => x.id === clip.mediaId);
  if (!m || !m.hasAudio) throw new Error(i18n.t("This clip has no audio."));
  const srcDur = clip.duration * clip.speed;
  const job = run("transcribe", m.name, (id) =>
    api.aiTranscribe({ jobId: id, media: m.path, start: clip.in, duration: srcDur, modelFile: opts.modelFile, language: opts.language, translate: opts.translate, maxLen: opts.maxLen }),
  );
  onJob?.(job.id);
  const jsonPath = await job.done;
  const { cues } = cuesFromWhisper(await api.readTextFile(jsonPath));
  // source-relative seconds → timeline seconds
  return cues
    .map((c) => ({ ...c, start: clip.start + c.start / clip.speed, end: clip.start + Math.min(c.end, srcDur) / clip.speed }))
    .filter((c) => c.end > c.start + 0.05);
}

/** Put cues on a new text track named "Subtitles". Returns the track id. */
export function addSubtitleTrack(cues: Cue[], name = i18n.t("Subtitles")): string {
  let trackId = "";
  commit(i18n.t("Add subtitles"), (d) => {
    const t: Track = ops.addTrack(d, "text", 0);
    t.name = name;
    trackId = t.id;
    for (const c of cueClips(cues, t.id, d.settings.height, d.settings.fps)) ops.addClip(d, c);
  });
  useUi.getState().select([]);
  return trackId;
}
