// AI editing assistant: understand a request (built-in parser or optional local Ollama model),
// show the plan, and only after approval execute each operation as its own undoable step.
import { api, errorText } from "../backend/api";
import { COLOR_PRESETS, defaultColor } from "../engine/color";
import { LLM_SYSTEM_PROMPT, parseCommand, validateOps, type AssistantOp } from "../engine/assistantParse";
import { REFRAME_ASPECTS } from "../engine/reframe";
import * as ops from "../engine/timelineOps";
import { addText, applyTransition } from "../editor/actions";
import { app } from "../store/appStore";
import { commit, getProject } from "../store/projectStore";
import { ui } from "../store/uiStore";
import { isMediaClip, type MediaClip, type Project } from "../types/project";
import { addSubtitleTrack, recommendedModel, refreshAiStatus, transcribeClip, useAi, WHISPER_MODELS } from "./ai";
import { applyReframe, planReframe } from "./reframe";
import type { Cue } from "../engine/subtitles";
import i18n from "../i18n";

const t = (k: string, o?: Record<string, unknown>): string => String(o ? i18n.t(k, o as never) : i18n.t(k));

export interface AssistantPlan {
  request: string;
  ops: AssistantOp[];
  /** "built-in" or the Ollama model name */
  provider: string;
  note?: string;
}

/** Understand a request. Uses the chosen Ollama model when given, falls back to the built-in parser. */
export async function understand(request: string, ollamaModel?: string | null): Promise<AssistantPlan> {
  if (ollamaModel) {
    try {
      const reply = await api.aiOllamaChat(ollamaModel, LLM_SYSTEM_PROMPT, request);
      const parsed = validateOps(JSON.parse(reply));
      if (parsed.length) return { request, ops: parsed, provider: ollamaModel };
      const local = parseCommand(request);
      return { request, ops: local, provider: "built-in", note: t("The local model proposed nothing usable; the built-in commands were used.") };
    } catch (e) {
      return { request, ops: parseCommand(request), provider: "built-in", note: t("Ollama failed ({{e}}); the built-in commands were used.", { e: errorText(e).slice(0, 120) }) };
    }
  }
  return { request, ops: parseCommand(request), provider: "built-in" };
}

const TRANSITION_NAMES: Record<string, string> = { fade: "Fade", dissolve: "Cross dissolve", "slide-left": "Slide left", "slide-right": "Slide right", "slide-up": "Slide up", "slide-down": "Slide down" };

/** Human readable description of one operation (for the approval list). */
export function describeOp(o: AssistantOp): string {
  switch (o.op) {
    case "removeSilence":
      return t("Cut silent pauses from all clips with sound");
    case "splitScenes":
      return t("Split video clips at scene changes");
    case "speed":
      return t("Set the speed of the selected clips to {{s}}×", { s: o.speed });
    case "transitions":
      return t("Add a “{{type}}” transition at every cut", { type: t(TRANSITION_NAMES[o.type]) });
    case "color":
      return t("Apply the colour look “{{name}}” to all video clips", { name: t(COLOR_PRESETS.find((p) => p.id === o.preset)?.name ?? o.preset) });
    case "reframe":
      return t("Smart reframe to {{a}} (keeps the person or moving subject in frame)", { a: o.aspect });
    case "subtitles":
      return o.translate ? t("Generate subtitles translated to English") : t("Generate automatic subtitles ({{l}})", { l: o.language === "auto" ? t("Auto-detect") : o.language });
    case "title":
      return t("Add the title “{{text}}” at the start", { text: o.text || t("Title") });
    case "export":
      return t("Open the export window");
  }
}

const lockedTrack = (p: Project, trackId: string) => !!p.tracks.find((tr) => tr.id === trackId)?.locked;

function mediaClips(p: Project, filter: (c: MediaClip) => boolean): MediaClip[] {
  return Object.values(p.clips)
    .filter((c): c is MediaClip => isMediaClip(c) && !lockedTrack(p, c.trackId))
    .filter(filter)
    .sort((a, b) => a.start - b.start);
}

const kindOf = (p: Project, c: MediaClip) => p.media.find((m) => m.id === c.mediaId)?.kind;

/** Speech normally comes with the camera footage (or its detached audio); background music files
 *  are left alone unless the project has no video with sound at all (e.g. a podcast). */
function speechClips(p: Project): MediaClip[] {
  const sounding = mediaClips(p, (c) => !c.muted && !!p.media.find((m) => m.id === c.mediaId && m.hasAudio && !m.missing));
  const fromVideo = sounding.filter((c) => kindOf(p, c) === "video");
  return fromVideo.length ? fromVideo : sounding;
}

async function removeSilence(): Promise<string> {
  const p = getProject()!;
  const targets = speechClips(p);
  if (!targets.length) return t("No clips with sound.");
  const cache = new Map<string, { start: number; end: number }[]>();
  const plan: { clip: MediaClip; ranges: { start: number; end: number }[] }[] = [];
  const pad = 0.12;
  for (const c of targets) {
    const m = p.media.find((x) => x.id === c.mediaId)!;
    if (!cache.has(m.path)) cache.set(m.path, await api.detectSilence(m.path, -35, 0.6));
    const srcEnd = c.in + c.duration * c.speed;
    const tl = (src: number) => c.start + (src - c.in) / c.speed;
    const ranges = cache
      .get(m.path)!
      .map((r) => ({ start: Math.max(r.start, c.in), end: Math.min(r.end < 0 ? m.duration : r.end, srcEnd) }))
      .filter((r) => r.end - r.start > 0)
      .map((r) => ({ start: tl(r.start) + (r.start > c.in + 1e-3 ? pad : 0), end: tl(r.end) - (r.end < srcEnd - 1e-3 ? pad : 0) }))
      .filter((r) => r.end - r.start >= 0.1);
    if (ranges.length) plan.push({ clip: c, ranges });
  }
  if (!plan.length) return t("No silent parts found.");
  let removed = 0;
  commit(t("Remove silence"), (d) => {
    // last first, so earlier clips keep their timeline positions
    for (const { clip, ranges } of [...plan].sort((a, b) => b.clip.start - a.clip.start)) {
      // keep a linked picture (detached audio's video, same media and span) in sync
      const partners = Object.values(d.clips).filter(
        (o) => o.id !== clip.id && isMediaClip(o) && o.mediaId === clip.mediaId && Math.abs(o.start - clip.start) < 1e-3 && Math.abs(o.duration - clip.duration) < 1e-3 && o.trackId !== clip.trackId,
      );
      removed += ops.removeRanges(d, clip.id, ranges, true);
      for (const o of partners) ops.removeRanges(d, o.id, ranges, true);
    }
  });
  return t("Removed {{s}} s of silence", { s: removed.toFixed(1) });
}

async function splitScenes(): Promise<string> {
  const p = getProject()!;
  const targets = mediaClips(p, (c) => kindOf(p, c) === "video");
  const plan: { id: string; cuts: number[] }[] = [];
  for (const c of targets) {
    const m = p.media.find((x) => x.id === c.mediaId)!;
    const found = await api.detectScenes(m.path, 0.3);
    const srcEnd = c.in + c.duration * c.speed;
    const cuts = found.filter((s) => s > c.in + 0.2 && s < srcEnd - 0.2).map((s) => c.start + (s - c.in) / c.speed);
    if (cuts.length) plan.push({ id: c.id, cuts });
  }
  const n = plan.reduce((a, x) => a + x.cuts.length, 0);
  if (!n) return t("No scene changes found.");
  commit(t("Split at scene changes"), (d) => {
    for (const { id, cuts } of plan) {
      let current = id;
      for (const cut of cuts) current = ops.splitClip(d, current, cut) ?? current;
    }
  });
  return t("{{n}} cuts added", { n });
}

function speed(s: number): string {
  const p = getProject()!;
  const sel = ui().selection.filter((id) => isMediaClip(p.clips[id]));
  if (!sel.length) throw new Error(t("Select the clips to change on the timeline first."));
  commit(t("Speed"), (d) => sel.forEach((id) => ops.setClipSpeed(d, id, s)));
  return t("{{n}} clips changed", { n: sel.length });
}

function transitions(type: AssistantOp & { op: "transitions" }): string {
  const p = getProject()!;
  const ids = Object.values(p.clips)
    .filter((c) => !lockedTrack(p, c.trackId) && p.tracks.find((tr) => tr.id === c.trackId)?.kind === "video" && ops.previousAdjacent(p, c))
    .map((c) => c.id);
  if (!ids.length) return t("There are no cuts between clips yet.");
  applyTransition(type.type, "in", 0.6, ids);
  return t("{{n}} transitions added", { n: ids.length });
}

function color(preset: string): string {
  const p = getProject()!;
  const pr = COLOR_PRESETS.find((x) => x.id === preset);
  if (!pr) throw new Error(preset);
  const targets = mediaClips(p, (c) => kindOf(p, c) === "video" || kindOf(p, c) === "image");
  if (!targets.length) return t("No video clips.");
  commit(t("Colour preset"), (d) => {
    for (const c of targets) {
      const x = d.clips[c.id] as MediaClip;
      x.color = { ...defaultColor(), ...pr.params, lutPath: x.color?.lutPath ?? null, lutIntensity: x.color?.lutIntensity ?? 1 };
    }
  });
  return t("{{n}} clips graded", { n: targets.length });
}

async function reframe(aspect: string, onStatus: (s: string) => void): Promise<string> {
  const p = getProject()!;
  const a = REFRAME_ASPECTS.find((x) => x.id === aspect)!;
  if (Math.abs(p.settings.width / p.settings.height - a.w / a.h) < 0.01) return t("The project is already {{a}}.", { a: aspect });
  const plan = await planReframe(a, (done, total, sub) => onStatus(t("Tracking the subject… {{d}}/{{n}}", { d: Math.min(total, done + 1), n: total }) + (sub !== undefined ? ` ${Math.round(sub * 100)}%` : "")));
  applyReframe(plan);
  return t("{{w}}×{{h}}, {{n}} clips reframed", { w: plan.width, h: plan.height, n: Object.keys(plan.results).length }) + (plan.skipped.length ? " · " + t("{{n}} positioned clips left as they were", { n: plan.skipped.length }) : "");
}

async function subtitles(o: AssistantOp & { op: "subtitles" }, onStatus: (s: string) => void): Promise<string> {
  await refreshAiStatus();
  const status = useAi.getState().status;
  if (!status?.whisper) throw new Error(t("The speech recognition engine (whisper.cpp) was not found."));
  const installed = WHISPER_MODELS.filter((m) => status.models.some((f) => f.file === m.file));
  if (!installed.length) throw new Error(t("Download a speech model first (AI panel → Automatic subtitles)."));
  const model = installed.find((m) => m.id === recommendedModel(app().system?.profile)) ?? installed[installed.length - 1];
  const p = getProject()!;
  const targets = speechClips(p);
  if (!targets.length) return t("No clips with sound.");
  const cues: Cue[] = [];
  for (const [i, c] of targets.entries()) {
    onStatus(t("Transcribing {{i}}/{{n}}…", { i: i + 1, n: targets.length }));
    cues.push(...(await transcribeClip(c, { modelFile: model.file, language: o.language, translate: o.translate, maxLen: 42 })));
  }
  if (!cues.length) return t("No speech was recognised.");
  cues.sort((a, b) => a.start - b.start);
  addSubtitleTrack(cues);
  return t("{{n}} subtitle lines added", { n: cues.length });
}

export interface StepResult {
  op: AssistantOp;
  ok: boolean;
  message: string;
}

/** Execute an approved plan, one undoable step per operation. */
export async function execute(plan: AssistantPlan, onStep: (index: number, status: string) => void): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const [i, o] of plan.ops.entries()) {
    onStep(i, t("Working…"));
    const status = (s: string) => onStep(i, s);
    try {
      let message: string;
      switch (o.op) {
        case "removeSilence":
          message = await removeSilence();
          break;
        case "splitScenes":
          message = await splitScenes();
          break;
        case "speed":
          message = speed(o.speed);
          break;
        case "transitions":
          message = transitions(o);
          break;
        case "color":
          message = color(o.preset);
          break;
        case "reframe":
          message = await reframe(o.aspect, status);
          break;
        case "subtitles":
          message = await subtitles(o, status);
          break;
        case "title":
          addText(o.text || t("Title"), { fontSize: 96, y: 0.25 }, 3, 0);
          message = t("Title added");
          break;
        case "export":
          app().openDialog("export");
          message = t("Export window opened");
          break;
      }
      results.push({ op: o, ok: true, message });
    } catch (e) {
      results.push({ op: o, ok: false, message: errorText(e) });
    }
  }
  return results;
}
