import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { importFiles, MEDIA_EXTENSIONS } from "../../services/media";
import { addMediaToTimeline } from "../../editor/actions";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useDrag } from "../../editor/dragdrop";
import TopBar from "./TopBar";
import Sidebar from "../sidebar/Sidebar";
import PreviewPanel from "../preview/PreviewPanel";
import Inspector from "../inspector/Inspector";
import Timeline, { timelineDropTarget, timelineWidth } from "../timeline/Timeline";
import ExportDialog from "../export/ExportDialog";
import ExportQueue from "../export/ExportQueue";
import { HistoryDialog, ProjectSettingsDialog, RelinkDialog, ShortcutsDialog } from "./Dialogs";

function DragGhost() {
  const { payload, label, x, y } = useDrag();
  if (!payload) return null;
  return (
    <div className="pointer-events-none fixed z-[200] max-w-[220px] truncate rounded-md border border-violet-400/60 bg-panel-2/95 px-2.5 py-1 text-[12px] shadow-xl" style={{ left: x + 12, top: y + 12 }} dir="auto">
      {label}
    </div>
  );
}

export default function Editor() {
  const { t } = useTranslation();
  const dialogs = useApp((s) => s.dialogs);
  const hasProject = useProject((s) => !!s.project);
  const fullscreen = useUi((s) => s.previewFullscreen);
  const rootRef = useRef<HTMLDivElement>(null);

  const importMedia = useCallback(async () => {
    const files = await openDialog({ multiple: true, filters: [{ name: t("Media files"), extensions: MEDIA_EXTENSIONS }] });
    if (files) await importFiles(Array.isArray(files) ? files : [files]);
  }, [t]);
  const opts = useMemo(() => ({ importMedia: () => void importMedia(), timelineWidth }), [importMedia]);
  useShortcuts(opts);

  // OS drag & drop: import, and place on the timeline when dropped over it.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent(async (ev) => {
      if (ev.payload.type !== "drop") return;
      const dpr = window.devicePixelRatio || 1;
      const x = ev.payload.position.x / dpr;
      const y = ev.payload.position.y / dpr;
      const target = timelineDropTarget(x, y);
      const assets = await importFiles(ev.payload.paths);
      if (target) {
        let at = target.time;
        for (const m of assets) {
          addMediaToTimeline(m, at, target.trackId);
          const c = useProject.getState().project?.clips[useUi.getState().selection[0]];
          if (c) at = c.start + c.duration;
        }
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // Save before the window closes.
  useEffect(() => {
    // Tauri closes the window after this handler returns (needs core:window:allow-destroy).
    const un = getCurrentWindow().onCloseRequested(async () => {
      await Promise.race([useProject.getState().saveNow(), new Promise((r) => setTimeout(r, 3000))]);
    });
    return () => void un.then((f) => f());
  }, []);

  // Keep fullscreen window state in sync with the preview fullscreen mode.
  useEffect(() => {
    void getCurrentWindow().setFullscreen(fullscreen).catch(() => undefined);
  }, [fullscreen]);

  const vLayout = useDefaultLayout({ id: "editor-v", storage: localStorage });
  const hLayout = useDefaultLayout({ id: "editor-h", storage: localStorage });

  if (!hasProject) return null;
  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <TopBar importMedia={() => void importMedia()} />
      <Group orientation="vertical" className="min-h-0 flex-1" id="editor-v" defaultLayout={vLayout.defaultLayout} onLayoutChanged={vLayout.onLayoutChanged}>
        <Panel id="top" minSize="30%" defaultSize="60%">
          <Group orientation="horizontal" id="editor-h" className="h-full" defaultLayout={hLayout.defaultLayout} onLayoutChanged={hLayout.onLayoutChanged}>
            <Panel id="left" defaultSize="24%" minSize={240} maxSize="40%">
              <Sidebar importMedia={() => void importMedia()} />
            </Panel>
            <Separator className="w-px" />
            <Panel id="center" minSize="30%">
              <PreviewPanel />
            </Panel>
            <Separator className="w-px" />
            <Panel id="right" defaultSize="22%" minSize={260} maxSize="40%">
              <Inspector />
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-px" />
        <Panel id="bottom" minSize={160} defaultSize="40%">
          <Timeline />
        </Panel>
      </Group>
      <ExportQueue />
      <DragGhost />
      {dialogs.export && <ExportDialog />}
      {dialogs.history && <HistoryDialog />}
      {dialogs.shortcuts && <ShortcutsDialog />}
      {dialogs.relink && <RelinkDialog />}
      {dialogs.projectSettings && <ProjectSettingsDialog />}
    </div>
  );
}
