// Pure timeline editing operations. Every function mutates a Project *draft*
// (used inside immer `produce`) and never touches the DOM.

import { uid } from "../lib/id";
import { EPS, snapFrame } from "../lib/time";
import { isMediaClip, type Clip, type MediaAsset, type Project, type Track, type TrackKind } from "../types/project";
import { makeTrack } from "./defaults";

/** JSON deep clone (works on immer drafts, unlike structuredClone). */
export const deepClone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const clipEnd = (c: Clip) => c.start + c.duration;

export function mediaOf(p: Project, c: Clip): MediaAsset | undefined {
  return isMediaClip(c) ? p.media.find((m) => m.id === c.mediaId) : undefined;
}

export function trackOf(p: Project, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id);
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const c of Object.values(p.clips)) d = Math.max(d, clipEnd(c));
  return d;
}

/** Can a clip of this kind live on that track? */
export function compatible(p: Project, c: Clip, track: Track): boolean {
  if (c.type === "text") return track.kind === "text";
  const m = mediaOf(p, c);
  if (!m) return false;
  if (m.kind === "audio") return track.kind === "audio";
  // video/image clips: video tracks; a video clip may also sit on an audio track (audio-only use)
  return track.kind === "video" || (track.kind === "audio" && m.kind === "video" && m.hasAudio);
}

/** Longest timeline duration a clip may have given its source media. */
export function maxDuration(p: Project, c: Clip): number {
  if (!isMediaClip(c)) return Infinity;
  const m = mediaOf(p, c);
  if (!m || m.kind === "image") return Infinity;
  return Math.max(0, (m.duration - c.in) / c.speed);
}

/** Maximum amount (seconds of timeline) the clip start can be extended earlier. */
export function maxStartExtension(p: Project, c: Clip): number {
  if (!isMediaClip(c)) return Infinity;
  const m = mediaOf(p, c);
  if (!m || m.kind === "image") return Infinity;
  return c.in / c.speed;
}

function shiftIn(c: Clip, deltaTimeline: number) {
  if (isMediaClip(c)) c.in = Math.max(0, c.in + deltaTimeline * c.speed);
}

/**
 * Overwrite semantics: make [start,end) free on a track by trimming, splitting
 * or removing clips (except `exclude`).
 */
export function clearRange(p: Project, trackId: string, start: number, end: number, exclude: Set<string> = new Set()) {
  if (end - start <= EPS) return;
  for (const c of clipsOnTrack(p, trackId)) {
    if (exclude.has(c.id)) continue;
    const cs = c.start;
    const ce = clipEnd(c);
    if (ce <= start + EPS || cs >= end - EPS) continue; // no overlap
    if (cs >= start - EPS && ce <= end + EPS) {
      delete p.clips[c.id]; // fully covered
    } else if (cs < start && ce > end) {
      // covers the range: split into left + right
      const right: Clip = deepClone(c);
      right.id = uid("clp");
      const cut = end - cs;
      right.start = end;
      right.duration = ce - end;
      shiftIn(right, cut);
      right.transitionIn = null;
      if (isMediaClip(right)) right.audioFadeIn = 0;
      p.clips[right.id] = right;
      c.duration = start - cs;
      c.transitionOut = null;
      if (isMediaClip(c)) c.audioFadeOut = 0;
    } else if (cs < start) {
      c.duration = start - cs; // overlaps on the left: trim end
    } else {
      const cut = end - cs; // overlaps on the right: trim start
      c.start = end;
      c.duration = ce - end;
      shiftIn(c, cut);
    }
  }
}

export function isRangeFree(p: Project, trackId: string, start: number, end: number, exclude: Set<string> = new Set()): boolean {
  return clipsOnTrack(p, trackId).every((c) => exclude.has(c.id) || clipEnd(c) <= start + EPS || c.start >= end - EPS);
}

/** Insert (overwrite) a clip. */
export function addClip(p: Project, clip: Clip) {
  const t = trackOf(p, clip.trackId);
  if (!t || t.locked) return;
  clip.start = Math.max(0, snapFrame(clip.start, p.settings.fps));
  clip.duration = Math.max(1 / p.settings.fps, snapFrame(clip.duration, p.settings.fps));
  clearRange(p, clip.trackId, clip.start, clip.start + clip.duration);
  p.clips[clip.id] = clip;
}

export interface ClipMove {
  id: string;
  start: number;
  trackId: string;
}

/** Move several clips at once (overwrite placement). Locked tracks are skipped. */
export function moveClips(p: Project, moves: ClipMove[]) {
  const fps = p.settings.fps;
  const valid = moves.filter((m) => {
    const c = p.clips[m.id];
    const from = c && trackOf(p, c.trackId);
    const to = trackOf(p, m.trackId);
    return c && from && to && !from.locked && !to.locked && compatible(p, c, to);
  });
  const moving = new Set(valid.map((m) => m.id));
  for (const m of valid) {
    const c = p.clips[m.id];
    c.start = Math.max(0, snapFrame(m.start, fps));
    c.trackId = m.trackId;
  }
  for (const m of valid) {
    const c = p.clips[m.id];
    if (c) clearRange(p, c.trackId, c.start, clipEnd(c), moving);
  }
}

/** Trim one edge of a clip to `time` (timeline seconds) with source constraints. */
export function trimClip(p: Project, id: string, edge: "start" | "end", time: number, ripple = false) {
  const c = p.clips[id];
  if (!c) return;
  const t = trackOf(p, c.trackId);
  if (!t || t.locked) return;
  const fps = p.settings.fps;
  const minDur = 1 / fps;
  time = snapFrame(time, fps);
  const oldEnd = clipEnd(c);
  if (edge === "end") {
    let d = time - c.start;
    d = Math.min(d, maxDuration(p, c));
    d = Math.max(minDur, d);
    const delta = d - c.duration;
    c.duration = snapFrame(d, fps);
    if (ripple && Math.abs(delta) > EPS) {
      for (const o of clipsOnTrack(p, c.trackId)) if (o.id !== c.id && o.start >= oldEnd - EPS) o.start = Math.max(0, o.start + delta);
    }
    clearRange(p, c.trackId, c.start, clipEnd(c), new Set([c.id]));
  } else {
    let s = Math.max(0, time);
    s = Math.max(s, c.start - maxStartExtension(p, c));
    s = Math.min(s, oldEnd - minDur);
    const delta = s - c.start; // positive = shorten
    shiftIn(c, delta);
    c.start = s;
    c.duration = snapFrame(oldEnd - s, fps);
    if (ripple && Math.abs(delta) > EPS) {
      // keep the left edge in place and pull everything after it
      c.start = s - delta;
      for (const o of clipsOnTrack(p, c.trackId)) if (o.id !== c.id && o.start >= oldEnd - EPS) o.start = Math.max(0, o.start - delta);
    }
    clearRange(p, c.trackId, c.start, clipEnd(c), new Set([c.id]));
  }
}

/** Split a clip at timeline time `t`. Returns the id of the right part. */
export function splitClip(p: Project, id: string, t: number): string | null {
  const c = p.clips[id];
  if (!c) return null;
  const tr = trackOf(p, c.trackId);
  if (!tr || tr.locked) return null;
  t = snapFrame(t, p.settings.fps);
  if (t <= c.start + EPS || t >= clipEnd(c) - EPS) return null;
  const right: Clip = deepClone(c);
  right.id = uid("clp");
  right.start = t;
  right.duration = clipEnd(c) - t;
  shiftIn(right, t - c.start);
  right.transitionIn = null;
  c.duration = t - c.start;
  c.transitionOut = null;
  if (isMediaClip(c) && isMediaClip(right)) {
    c.audioFadeOut = 0;
    right.audioFadeIn = 0;
  }
  p.clips[right.id] = right;
  return right.id;
}

/** Split selected clips (or every clip under the playhead on unlocked tracks). */
export function splitAt(p: Project, t: number, ids?: string[]): string[] {
  const targets = (ids && ids.length ? ids : Object.keys(p.clips)).filter((id) => {
    const c = p.clips[id];
    return c && c.start < t - EPS && clipEnd(c) > t + EPS;
  });
  const created: string[] = [];
  for (const id of targets) {
    const r = splitClip(p, id, t);
    if (r) created.push(r);
  }
  return created;
}

/** Delete clips; with `ripple`, close the gaps they leave on their tracks. */
export function deleteClips(p: Project, ids: string[], ripple = false) {
  const removed = ids
    .map((id) => p.clips[id])
    .filter((c): c is Clip => !!c && !trackOf(p, c.trackId)?.locked)
    .sort((a, b) => b.start - a.start);
  for (const c of removed) {
    delete p.clips[c.id];
    if (ripple) {
      for (const o of clipsOnTrack(p, c.trackId)) if (o.start >= clipEnd(c) - EPS) o.start = Math.max(0, o.start - c.duration);
    }
  }
}

/** Remove the empty gap at time t on a track by pulling later clips left. */
export function closeGapAt(p: Project, trackId: string, t: number): boolean {
  const list = clipsOnTrack(p, trackId);
  if (trackOf(p, trackId)?.locked) return false;
  let prevEnd = 0;
  for (const c of list) {
    if (c.start > t + EPS && prevEnd <= t + EPS) {
      const gap = c.start - prevEnd;
      for (const o of list) if (o.start >= c.start - EPS) o.start -= gap;
      return gap > EPS;
    }
    prevEnd = Math.max(prevEnd, clipEnd(c));
  }
  return false;
}

/** Change playback speed keeping the start; duration follows the source length. */
export function setClipSpeed(p: Project, id: string, speed: number) {
  const c = p.clips[id];
  if (!isMediaClip(c)) return;
  speed = Math.min(16, Math.max(0.1, speed));
  const srcLen = c.duration * c.speed;
  c.speed = speed;
  c.duration = Math.max(1 / p.settings.fps, snapFrame(srcLen / speed, p.settings.fps));
  c.duration = Math.min(c.duration, maxDuration(p, c));
  clearRange(p, c.trackId, c.start, clipEnd(c), new Set([c.id]));
}

export function addTrack(p: Project, kind: TrackKind, index?: number): Track {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : "T";
  const t = makeTrack(kind, `${prefix}${n}`);
  if (index === undefined) {
    // text on top, then video (new video tracks above existing), audio at the bottom
    if (kind === "text") index = 0;
    else if (kind === "video") index = p.tracks.findIndex((x) => x.kind === "video");
    else index = p.tracks.length;
    if (index < 0) index = kind === "video" ? p.tracks.filter((x) => x.kind === "text").length : p.tracks.length;
  }
  p.tracks.splice(index, 0, t);
  return t;
}

export function removeTrack(p: Project, id: string) {
  for (const c of Object.values(p.clips)) if (c.trackId === id) delete p.clips[c.id];
  p.tracks = p.tracks.filter((t) => t.id !== id);
}

/** Find an unlocked track of `kind` free over [start,end), creating one if needed. */
export function findFreeTrack(p: Project, kind: TrackKind, start: number, end: number, preferId?: string): Track {
  // video: bottom-most (main) track first; audio/text: top-most first
  const base = kind === "video" ? [...p.tracks].reverse() : [...p.tracks];
  const pref = base.find((t) => t.id === preferId);
  const order = pref ? [pref, ...base.filter((t) => t !== pref)] : base;
  for (const t of order) if (t.kind === kind && !t.locked && isRangeFree(p, t.id, start, end)) return t;
  return addTrack(p, kind);
}

/** Separate the audio of a video clip onto an audio track. */
export function detachAudio(p: Project, id: string): string | null {
  const c = p.clips[id];
  if (!isMediaClip(c)) return null;
  const m = mediaOf(p, c);
  if (!m || m.kind !== "video" || !m.hasAudio || c.muted) return null;
  const track = findFreeTrack(p, "audio", c.start, clipEnd(c));
  const a = deepClone(c);
  a.id = uid("clp");
  a.trackId = track.id;
  a.transitionIn = null;
  a.transitionOut = null;
  p.clips[a.id] = a;
  c.muted = true;
  return a.id;
}

/** Paste copied clips so the earliest starts at `at`. Returns new ids. */
export function pasteClips(p: Project, clips: Clip[], at: number, preferTrackId?: string): string[] {
  if (!clips.length) return [];
  const minStart = Math.min(...clips.map((c) => c.start));
  const ids: string[] = [];
  const singleTrack = new Set(clips.map((c) => c.trackId)).size === 1;
  for (const src of clips) {
    const c = deepClone(src);
    c.id = uid("clp");
    c.start = snapFrame(at + (src.start - minStart), p.settings.fps);
    let track = trackOf(p, singleTrack && preferTrackId ? preferTrackId : c.trackId);
    if (!track || track.locked || !compatible(p, c, track)) {
      const kind: TrackKind = c.type === "text" ? "text" : mediaOf(p, c)?.kind === "audio" ? "audio" : "video";
      track = findFreeTrack(p, kind, c.start, clipEnd(c));
    }
    c.trackId = track.id;
    if (isMediaClip(c) && !p.media.some((m) => m.id === c.mediaId)) continue;
    addClip(p, c);
    ids.push(c.id);
  }
  return ids;
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  point?: number;
}

/** Collect snap targets: clip edges, playhead, markers and 0. */
export function snapPoints(p: Project, exclude: Set<string>, playhead: number): number[] {
  const pts = [0, playhead];
  for (const c of Object.values(p.clips)) {
    if (exclude.has(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  for (const m of p.markers) pts.push(m.time);
  return pts;
}

/** Snap any of the candidate edges (offsets from `t`) to the nearest point within `threshold`. */
export function snapTime(t: number, edges: number[], points: number[], threshold: number): SnapResult {
  let best: SnapResult = { time: t, snapped: false };
  let bestDist = threshold;
  for (const e of edges) {
    for (const pt of points) {
      const d = Math.abs(t + e - pt);
      if (d < bestDist) {
        bestDist = d;
        best = { time: pt - e, snapped: true, point: pt };
      }
    }
  }
  return best;
}

/** Adjacent clip on the same track that ends exactly where `c` starts. */
export function previousAdjacent(p: Project, c: Clip): Clip | undefined {
  const tol = 0.5 / p.settings.fps;
  return Object.values(p.clips).find((o) => o.id !== c.id && o.trackId === c.trackId && Math.abs(clipEnd(o) - c.start) <= tol);
}

/**
 * Cut timeline ranges out of a clip (e.g. detected silences) and close the gaps.
 * Ranges are timeline seconds and are clamped to the clip. Returns removed seconds.
 */
export function removeRanges(p: Project, clipId: string, ranges: { start: number; end: number }[], ripple = true): number {
  const c = p.clips[clipId];
  if (!c || trackOf(p, c.trackId)?.locked) return 0;
  const fps = p.settings.fps;
  const cs = c.start;
  const ce = clipEnd(c);
  const rs = ranges
    .map((r) => ({ start: snapFrame(Math.max(cs, r.start), fps), end: snapFrame(Math.min(ce, r.end), fps) }))
    .filter((r) => r.end - r.start >= 1 / fps)
    .sort((a, b) => b.start - a.start);
  let removed = 0;
  let current: string = clipId;
  for (const r of rs) {
    // `current` is always the left-most piece still containing [r.start, r.end]
    const right = splitClip(p, current, r.end);
    const mid = splitClip(p, current, r.start);
    const target = mid ?? (Math.abs(p.clips[current].start - r.start) < 1e-6 ? current : null);
    if (!target) continue;
    const dur = p.clips[target].duration;
    delete p.clips[target];
    removed += dur;
    if (ripple) for (const o of clipsOnTrack(p, c.trackId)) if (o.start >= r.end - EPS) o.start = Math.max(0, o.start - dur);
    if (target === current) {
      // the cut started at the clip start; continue on the right piece
      if (!right) break;
      current = right;
    }
  }
  return removed;
}
