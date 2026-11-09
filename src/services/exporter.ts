// Export queue: jobs run one at a time in the background (Rust/FFmpeg); the UI stays editable.
import { api, errorText } from "../backend/api";
import { buildExport, compositionSize, layerPixelSize, needsAssets, textFileName, textLayersFor, type ClipAssets } from "../engine/exportGraph";
import { buildLut, parseCube, toCube } from "../engine/color";
import { canvasPng, drawMask, drawVignette } from "../engine/layerFx";
import { videoLayers } from "../engine/segments";
import type { ExportSettings } from "../engine/presets";
import { textClipToPng } from "../engine/textRender";
import { uid } from "../lib/id";
import { app, type ExportJob } from "../store/appStore";
import { getProject } from "../store/projectStore";
import { isMediaClip, isTextClip, type Project } from "../types/project";

const utf8Base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
import i18n from "../i18n";

const snapshots = new Map<string, Project>();

export function enqueueExport(settings: ExportSettings, outputPath: string, name: string) {
  const p = getProject();
  if (!p) return;
  const id = uid("exp");
  snapshots.set(id, p); // immutable snapshot – editing can continue
  const job: ExportJob = { id, name, outputPath, status: "queued", progress: 0, settings, projectId: p.id };
  app().set({ exports: [...app().exports, job] });
  void pump();
}

async function pump() {
  const jobs = app().exports;
  if (jobs.some((j) => j.status === "running" || j.status === "preparing")) return;
  const next = jobs.find((j) => j.status === "queued");
  if (!next) return;
  await runJob(next);
}

async function runJob(job: ExportJob) {
  const p = snapshots.get(job.id);
  if (!p) return;
  app().updateExport(job.id, { status: "preparing", startedAt: Date.now() });
  try {
    const missing = p.media.filter((m) => m.missing && Object.values(p.clips).some((c) => c.type === "media" && c.mediaId === m.id));
    if (missing.length) throw new Error(i18n.t("Missing media: {{names}}", { names: missing.map((m) => m.name).join(", ") }));
    const { unit, w, h } = compositionSize(p, job.settings);
    const textPaths: Record<string, string> = {};
    for (const id of textLayersFor(p)) {
      const c = p.clips[id];
      if (!isTextClip(c)) continue;
      const png = await textClipToPng(c, w, h, unit);
      textPaths[id] = await api.writeJobFile(job.id, textFileName(id), png);
    }
    // colour LUTs, vignettes and masks are rendered with the same code as the preview
    const assets: Record<string, ClipAssets> = {};
    for (const layer of videoLayers(p, w, h)) {
      const c = layer.clip;
      if (!isMediaClip(c) || !layer.media) continue;
      const need = needsAssets(c);
      if (!need.lut && !need.vignette && !need.mask) continue;
      const a: ClipAssets = {};
      if (need.lut) {
        const user = c.color!.lutPath ? parseCube(await api.readTextFile(c.color!.lutPath)) : null;
        a.lut = await api.writeJobFile(job.id, `lut_${c.id}.cube`, utf8Base64(toCube(buildLut(c.color!, user))));
      }
      const size = layerPixelSize(p, c, layer.media.width, layer.media.height, w, h, unit);
      const vig = c.effects?.find((e) => e.enabled && e.type === "vignette" && e.amount > 0);
      if (need.vignette && vig) a.vignette = await api.writeJobFile(job.id, `vig_${c.id}.png`, await canvasPng(size.w, size.h, (ctx) => drawVignette(ctx, size.w, size.h, vig.amount)));
      if (need.mask && c.mask) a.mask = await api.writeJobFile(job.id, `mask_${c.id}.png`, await canvasPng(size.w, size.h, (ctx) => drawMask(ctx, size.w, size.h, c.mask!)));
      assets[c.id] = a;
    }
    const plan = buildExport(p, job.settings, textPaths, assets);
    if (app().exports.find((j) => j.id === job.id)?.status === "cancelled") return;
    await api.startExport({ jobId: job.id, inputArgs: plan.inputArgs, filterGraph: plan.filterGraph, outputArgs: plan.outputArgs, outputPath: job.outputPath, duration: plan.duration });
    app().updateExport(job.id, { status: "running" });
  } catch (e) {
    app().updateExport(job.id, { status: "error", message: errorText(e), finishedAt: Date.now() });
    snapshots.delete(job.id);
    void pump();
  }
}

export async function cancelExport(id: string) {
  const j = app().exports.find((x) => x.id === id);
  if (!j) return;
  if (j.status === "queued" || j.status === "preparing") {
    app().updateExport(id, { status: "cancelled", finishedAt: Date.now() });
    snapshots.delete(id);
    return;
  }
  await api.cancelJob(id);
}

export function clearFinishedExports() {
  app().set({ exports: app().exports.filter((j) => j.status === "queued" || j.status === "running" || j.status === "preparing") });
}

// ----- event handlers (wired in App)
export function onExportProgress(id: string, progress: number, eta?: number | null, fps?: number, speed?: string) {
  if (!snapshots.has(id)) return false;
  app().updateExport(id, { progress, eta, fps, speed, status: "running" });
  return true;
}

export function onExportEnd(id: string, status: "done" | "error" | "cancelled", message?: string | null) {
  if (!snapshots.has(id)) return false;
  snapshots.delete(id);
  const j = app().exports.find((x) => x.id === id);
  app().updateExport(id, { status, message: message ?? undefined, progress: status === "done" ? 1 : j?.progress ?? 0, finishedAt: Date.now() });
  if (status === "done") app().toast(i18n.t("Export finished: {{name}}", { name: j?.name ?? "" }), "success");
  if (status === "error") app().toast(i18n.t("Export failed: {{name}}", { name: j?.name ?? "" }), "error");
  void pump();
  return true;
}
