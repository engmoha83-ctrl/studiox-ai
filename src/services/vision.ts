// Local face analysis (YuNet in the Rust core) with progress + cancel.
import { api, onAiProgress } from "../backend/api";
import type { FaceFrame } from "../engine/faces";
import { uid } from "../lib/id";

export async function analyzeFaces(path: string, start: number, duration: number, rate = 2, onProgress?: (p: number) => void, onJob?: (id: string) => void): Promise<FaceFrame[]> {
  const id = uid("faces");
  onJob?.(id);
  const un = await onAiProgress((e) => e.id === id && onProgress?.(e.progress));
  try {
    return await api.analyzeFaces(id, path, start, duration, rate);
  } finally {
    un();
  }
}
