import { createProject, makeMediaClip, makeTextClip } from "../src/engine/defaults";
import type { MediaAsset, Project } from "../src/types/project";

export function media(id: string, kind: MediaAsset["kind"], duration: number, path = `/media/${id}`, w = 1280, h = 720): MediaAsset {
  return {
    id, path, name: id, kind, duration, width: w, height: h, fps: 30,
    hasVideo: kind !== "audio", hasAudio: kind !== "image", size: 1, mtime: 1, addedAt: 0,
  };
}

export function setup(): { p: Project; v1: string; v2: string; a1: string; t1: string } {
  const p = createProject("Test", { width: 1280, height: 720, fps: 30 });
  p.media.push(media("vid", "video", 20), media("img", "image", 0), media("aud", "audio", 30));
  const t1 = p.tracks.find((t) => t.kind === "text")!.id;
  const v2 = p.tracks.filter((t) => t.kind === "video")[0].id;
  const v1 = p.tracks.filter((t) => t.kind === "video")[1].id;
  const a1 = p.tracks.find((t) => t.kind === "audio")!.id;
  return { p, v1, v2, a1, t1 };
}

export { makeMediaClip, makeTextClip };
