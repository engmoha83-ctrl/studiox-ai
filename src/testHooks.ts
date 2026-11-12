// Automation hooks for the end-to-end test-suite (tests/app). Only installed when
// the "studiox:e2e" localStorage flag is set; they expose nothing that the UI cannot do.
import { importFiles } from "./services/media";
import { useProject } from "./store/projectStore";
import { useUi } from "./store/uiStore";
import { useApp } from "./store/appStore";
import { player } from "./preview/player";
import { addMediaToTimeline, setSpeed } from "./editor/actions";
import { parseSubtitles } from "./engine/subtitles";
import { addSubtitleTrack, refreshAiStatus, useAi } from "./services/ai";

export function installTestHooks() {
  try {
    if (localStorage.getItem("studiox:e2e") !== "1") return;
  } catch {
    return;
  }
  (window as unknown as Record<string, unknown>).__studiox = {
    importFiles,
    project: () => useProject.getState().project,
    history: () => useProject.getState().past.map((e) => e.label).slice(-4),
    ui: () => useUi.getState(),
    app: () => useApp.getState(),
    seek: (t: number) => player.seek(t),
    select: (ids: string[]) => useUi.getState().select(ids),
    setSpeed: (id: string, v: number) => setSpeed(id, v),
    addToTimeline: (mediaId: string, at: number, trackId?: string) => {
      const m = useProject.getState().project?.media.find((x) => x.id === mediaId);
      if (m) addMediaToTimeline(m, at, trackId);
      return useUi.getState().selection[0];
    },
    importSubtitles: (text: string) => addSubtitleTrack(parseSubtitles(text)),
    aiStatus: async () => (await refreshAiStatus(), useAi.getState().status),
  };
}
