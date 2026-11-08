// User-level editing commands (used by shortcuts, toolbar, menus). Each is one undoable step.
import i18n from "../i18n";
import { makeMediaClip, makeTextClip } from "../engine/defaults";
import * as ops from "../engine/timelineOps";
import { commit, getProject } from "../store/projectStore";
import { app } from "../store/appStore";
import { ui, useUi } from "../store/uiStore";
import { isMediaClip, type Clip, type MediaAsset, type TextStyle, type TransitionType } from "../types/project";
import { player } from "../preview/player";

const t = (k: string, o?: Record<string, unknown>): string => String(o ? i18n.t(k, o as never) : i18n.t(k));

export function splitAtPlayhead() {
  const p = getProject();
  if (!p) return;
  const at = ui().playhead;
  const sel = ui().selection.filter((id) => p.clips[id]);
  let created: string[] = [];
  commit(t("Split"), (d) => {
    created = ops.splitAt(d, at, sel.length ? sel : undefined);
  });
  if (!created.length) app().toast(t("Nothing to split at the playhead."));
}

export function deleteSelection(ripple = ui().ripple) {
  const sel = ui().selection;
  if (!sel.length) return;
  commit(ripple ? t("Ripple delete") : t("Delete"), (d) => ops.deleteClips(d, sel, ripple));
  useUi.getState().select([]);
}

export function copySelection(cut = false) {
  const p = getProject();
  if (!p) return;
  const clips = ui()
    .selection.map((id) => p.clips[id])
    .filter(Boolean) as Clip[];
  if (!clips.length) return;
  useUi.getState().set({ clipboard: ops.deepClone(clips) });
  if (cut) deleteSelection(false);
}

export function paste() {
  const clips = ui().clipboard;
  if (!clips.length) return;
  let ids: string[] = [];
  commit(t("Paste"), (d) => {
    ids = ops.pasteClips(d, clips, ui().playhead);
  });
  useUi.getState().select(ids);
}

export function duplicateSelection() {
  const p = getProject();
  if (!p) return;
  const clips = ui()
    .selection.map((id) => p.clips[id])
    .filter(Boolean) as Clip[];
  if (!clips.length) return;
  const end = Math.max(...clips.map(ops.clipEnd));
  let ids: string[] = [];
  commit(t("Duplicate"), (d) => {
    ids = ops.pasteClips(d, clips, end);
  });
  useUi.getState().select(ids);
}

export function selectAll() {
  const p = getProject();
  if (p) useUi.getState().select(Object.keys(p.clips));
}

/** Append media at the playhead (or a given time) on a suitable track. */
export function addMediaToTimeline(media: MediaAsset, at?: number, trackId?: string) {
  const p = getProject();
  if (!p) return;
  if (media.missing) {
    app().toast(t("This file is missing. Relink it first."), "error");
    return;
  }
  const start = at ?? ui().playhead;
  let id = "";
  commit(t("Add clip"), (d) => {
    const kind = media.kind === "audio" ? "audio" : "video";
    const probe = makeMediaClip(media, "", start, d.settings.fps);
    const track = trackId && ops.trackOf(d, trackId) ? ops.trackOf(d, trackId)! : ops.findFreeTrack(d, kind, probe.start, probe.start + probe.duration);
    probe.trackId = track.id;
    if (!ops.compatible(d, probe, track)) probe.trackId = ops.findFreeTrack(d, kind, probe.start, probe.start + probe.duration).id;
    const m = d.media.find((x) => x.id === media.id);
    if (m) m.lastUsedAt = Date.now();
    ops.addClip(d, probe);
    id = probe.id;
  });
  if (id) useUi.getState().select([id]);
}

export function addText(text: string, style: Partial<TextStyle> = {}, duration?: number, at?: number) {
  const p = getProject();
  if (!p) return;
  let id = "";
  commit(t("Add text"), (d) => {
    const start = at ?? ui().playhead;
    const dur = duration ?? 4;
    const track = ops.findFreeTrack(d, "text", start, start + dur);
    const c = makeTextClip(track.id, start, text, style, dur);
    ops.addClip(d, c);
    id = c.id;
  });
  if (id) useUi.getState().select([id]);
}

export function applyTransition(type: TransitionType | null, edge: "in" | "out" | "both", duration = 0.6, ids = ui().selection) {
  const p = getProject();
  if (!p) return;
  const targets = ids.filter((id) => p.clips[id]);
  if (!targets.length) {
    app().toast(t("Select one or more clips on the timeline first."));
    return;
  }
  commit(t("Transition"), (d) => {
    for (const id of targets) {
      const c = d.clips[id];
      const tr = type ? { type, duration: Math.min(duration, c.duration / 2) } : null;
      if (edge !== "out") c.transitionIn = tr;
      if (edge !== "in") c.transitionOut = tr && (tr.type.startsWith("slide") || tr.type === "dissolve" || tr.type === "fade") ? tr : null;
    }
  });
}

export function detachAudioSelected() {
  const sel = ui().selection;
  let n = 0;
  commit(t("Detach audio"), (d) => {
    for (const id of sel) if (ops.detachAudio(d, id)) n++;
  });
  if (!n) app().toast(t("Select a video clip that has audio."));
}

export function setSpeed(id: string, speed: number) {
  commit(t("Speed"), (d) => ops.setClipSpeed(d, id, speed), `speed:${id}`);
}

export function seekToEdge(dir: -1 | 1) {
  const p = getProject();
  if (!p) return;
  const now = ui().playhead;
  const edges = [0, ...Object.values(p.clips).flatMap((c) => [c.start, ops.clipEnd(c)])].sort((a, b) => a - b);
  const target = dir > 0 ? edges.find((e) => e > now + 1e-4) : [...edges].reverse().find((e) => e < now - 1e-4);
  if (target !== undefined) player.seek(target);
}

export function zoomToFit(width: number) {
  const p = getProject();
  if (!p) return;
  const d = Math.max(5, ops.projectDuration(p));
  useUi.getState().setZoom((width - 40) / d);
}

export function selectedMediaClip() {
  const p = getProject();
  const id = ui().selection[0];
  const c = p && id ? p.clips[id] : undefined;
  return isMediaClip(c) ? c : undefined;
}
