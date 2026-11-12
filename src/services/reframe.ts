// Smart reframe service: analyse every visual clip (locally, FFmpeg) then apply the new
// aspect ratio + cover scale + pan keyframes as ONE undoable step.
import { api } from "../backend/api";
import { canReframe, reframeClip, reframeSize, type Aspect, type FocusSample, type ReframeResult } from "../engine/reframe";
import { commit, getProject } from "../store/projectStore";
import { isMediaClip, type MediaClip } from "../types/project";
import { faceCoverage, primaryFaceTrack } from "../engine/faces";
import { analyzeFaces } from "./vision";
import i18n from "../i18n";

export interface ReframePlan {
  aspect: Aspect;
  width: number;
  height: number;
  results: Record<string, ReframeResult>;
  /** clips left untouched because the user already positioned/animated them */
  skipped: string[];
  tracked: number;
  /** clips framed on a detected face (the rest follow motion/detail) */
  faces: number;
}

/** Face tracking is used when a face is visible in at least this share of a clip's frames. */
const FACE_MIN_COVERAGE = 0.3;

export async function planReframe(aspect: Aspect, onProgress?: (done: number, total: number, sub?: number) => void): Promise<ReframePlan> {
  const p = getProject();
  if (!p) throw new Error("no project");
  const { width, height } = reframeSize(p.settings.width, p.settings.height, aspect);
  const visual = Object.values(p.clips).filter((c): c is MediaClip => {
    if (!isMediaClip(c)) return false;
    const m = p.media.find((x) => x.id === c.mediaId);
    return !!m && m.kind !== "audio";
  });
  const results: Record<string, ReframeResult> = {};
  const skipped: string[] = [];
  let tracked = 0;
  let faces = 0;
  let done = 0;
  for (const c of visual) {
    const m = p.media.find((x) => x.id === c.mediaId)!;
    if (!canReframe(c, m)) {
      skipped.push(c.id);
    } else {
      let samples: FocusSample[] = [];
      if (m.kind === "video" && !m.missing) {
        const dur = c.duration * c.speed;
        let faceFrames: Awaited<ReturnType<typeof analyzeFaces>> = [];
        try {
          faceFrames = await analyzeFaces(m.path, c.in, dur, 2, (p) => onProgress?.(done, visual.length, p));
        } catch {
          faceFrames = []; // face model unavailable → motion tracking still works
        }
        if (faceCoverage(faceFrames) >= FACE_MIN_COVERAGE) {
          samples = primaryFaceTrack(faceFrames);
          faces++;
        } else {
          samples = await api.analyzeFocus(m.path, c.in, dur);
        }
        if (samples.some((s) => s.weight > 0)) tracked++;
      }
      results[c.id] = reframeClip(c, m, width, height, samples);
    }
    onProgress?.(++done, visual.length);
  }
  return { aspect, width, height, results, skipped, tracked, faces };
}

export function applyReframe(plan: ReframePlan) {
  commit(i18n.t("Smart reframe {{a}}", { a: plan.aspect.id }), (d) => {
    d.settings.width = plan.width;
    d.settings.height = plan.height;
    for (const [id, r] of Object.entries(plan.results)) {
      const c = d.clips[id];
      if (!isMediaClip(c)) continue;
      c.transform.scale = r.scale;
      c.transform.x = r.x;
      c.transform.y = r.y;
      c.keyframes = { ...(c.keyframes ?? {}) };
      if (r.kx) c.keyframes.x = r.kx;
      else delete c.keyframes.x;
      if (r.ky) c.keyframes.y = r.ky;
      else delete c.keyframes.y;
    }
  });
}
