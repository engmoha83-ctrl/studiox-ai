// "Follow a face": make an overlay (sticker, logo, picture-in-picture) track a person in the
// video below it. Analysis is local (YuNet); the result is keyframes the user can edit.
import { followFace, type FollowResult } from "../engine/faces";
import { clipEnd } from "../engine/timelineOps";
import { commit, getProject } from "../store/projectStore";
import { isMediaClip, type MediaClip, type Project } from "../types/project";
import { analyzeFaces } from "./vision";
import i18n from "../i18n";

/** The video clip under `overlay` that overlaps it the most (on a lower video track). */
export function baseClipFor(p: Project, overlay: MediaClip): MediaClip | null {
  const order = p.tracks.map((tr) => tr.id);
  const myIndex = order.indexOf(overlay.trackId);
  let best: MediaClip | null = null;
  let bestOverlap = 0;
  for (const c of Object.values(p.clips)) {
    if (!isMediaClip(c) || c.id === overlay.id) continue;
    if (order.indexOf(c.trackId) <= myIndex) continue;
    const m = p.media.find((x) => x.id === c.mediaId);
    if (!m || m.kind !== "video" || m.missing) continue;
    const ov = Math.min(clipEnd(c), clipEnd(overlay)) - Math.max(c.start, overlay.start);
    if (ov > bestOverlap) [best, bestOverlap] = [c, ov];
  }
  return best;
}

export interface FollowPlan {
  overlayId: string;
  baseId: string;
  result: FollowResult;
  frames: number;
}

export async function planFollow(overlayId: string, withScale: boolean, onProgress?: (p: number) => void): Promise<FollowPlan> {
  const p = getProject()!;
  const overlay = p.clips[overlayId];
  if (!isMediaClip(overlay)) throw new Error(i18n.t("Select a sticker, image or video overlay first."));
  const base = baseClipFor(p, overlay);
  if (!base) throw new Error(i18n.t("There is no video under this clip to track."));
  const m = p.media.find((x) => x.id === base.mediaId)!;
  // only the part of the base clip under the overlay
  const from = Math.max(base.start, overlay.start);
  const to = Math.min(clipEnd(base), clipEnd(overlay));
  const srcStart = base.in + (from - base.start) * base.speed;
  const srcDur = (to - from) * base.speed;
  const frames = await analyzeFaces(m.path, srcStart, srcDur, Math.min(8, 4 * Math.max(1, base.speed)), onProgress);
  const result = followFace(overlay, base, m, p.settings.width, p.settings.height, frames, srcStart, withScale);
  if (!result) throw new Error(i18n.t("No face was found in the video under this clip."));
  return { overlayId, baseId: base.id, result, frames: frames.length };
}

export function applyFollow(plan: FollowPlan) {
  commit(i18n.t("Follow face"), (d) => {
    const c = d.clips[plan.overlayId];
    if (!isMediaClip(c)) return;
    c.keyframes = { ...(c.keyframes ?? {}), x: plan.result.x, y: plan.result.y };
    if (plan.result.scale) c.keyframes.scale = plan.result.scale;
  });
}
