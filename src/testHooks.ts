// Automation hooks for the end-to-end test-suite (tests/app). Only installed when
// the "studiox:e2e" localStorage flag is set; they expose nothing that the UI cannot do.
import { importFiles } from "./services/media";
import { useProject } from "./store/projectStore";
import { useUi } from "./store/uiStore";
import { useApp } from "./store/appStore";
import { player } from "./preview/player";

export function installTestHooks() {
  try {
    if (localStorage.getItem("studiox:e2e") !== "1") return;
  } catch {
    return;
  }
  (window as unknown as Record<string, unknown>).__studiox = {
    importFiles,
    project: () => useProject.getState().project,
    ui: () => useUi.getState(),
    app: () => useApp.getState(),
    seek: (t: number) => player.seek(t),
    select: (ids: string[]) => useUi.getState().select(ids),
  };
}
