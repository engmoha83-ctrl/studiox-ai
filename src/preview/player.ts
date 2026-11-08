// Global transport controller bridging the UI and the PreviewEngine instance.
import { projectDuration } from "../engine/timelineOps";
import { snapFrame } from "../lib/time";
import { getProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";
import type { PreviewEngine } from "./PreviewEngine";

let engine: PreviewEngine | null = null;

export function attachEngine(e: PreviewEngine | null) {
  engine = e;
  if (e) {
    e.onTime = (t) => useUi.getState().setPlayhead(t);
    e.onStop = () => useUi.getState().setPlaying(false);
    e.seek(useUi.getState().playhead);
  }
}

export const player = {
  play() {
    if (!engine) return;
    engine.setRate(useUi.getState().playbackRate);
    engine.play();
    useUi.getState().setPlaying(engine.playing);
  },
  pause() {
    engine?.pause();
    useUi.getState().setPlaying(false);
  },
  toggle() {
    if (engine?.playing) player.pause();
    else player.play();
  },
  seek(t: number) {
    const p = getProject();
    const fps = p?.settings.fps ?? 30;
    const max = p ? Math.max(projectDuration(p), 0) : 0;
    const v = Math.min(Math.max(0, snapFrame(t, fps)), max);
    useUi.getState().setPlayhead(v);
    engine?.seek(v);
  },
  step(frames: number) {
    const p = getProject();
    const fps = p?.settings.fps ?? 30;
    if (engine?.playing) player.pause();
    player.seek(useUi.getState().playhead + frames / fps);
  },
  setRate(r: number) {
    useUi.getState().set({ playbackRate: r });
    engine?.setRate(r);
  },
  engine: () => engine,
};
