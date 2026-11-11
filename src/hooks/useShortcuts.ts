import { useEffect } from "react";
import * as A from "../editor/actions";
import { player } from "../preview/player";
import { useApp } from "../store/appStore";
import { useProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";
import i18n from "../i18n";

export interface ShortcutDef {
  keys: string;
  label: string;
}

/** Shown in the shortcuts dialog. */
export const SHORTCUTS: ShortcutDef[] = [
  { keys: "Space", label: "Play / pause" },
  { keys: "← / →", label: "Previous / next frame" },
  { keys: "Shift + ← / →", label: "Back / forward 1 second" },
  { keys: "↑ / ↓", label: "Previous / next edit point" },
  { keys: "Home / End", label: "Go to start / end" },
  { keys: "S  ·  Ctrl + B", label: "Split at playhead" },
  { keys: "Delete", label: "Delete selection" },
  { keys: "Shift + Delete", label: "Ripple delete" },
  { keys: "Ctrl + Z", label: "Undo" },
  { keys: "Ctrl + Shift + Z  ·  Ctrl + Y", label: "Redo" },
  { keys: "Ctrl + C / X / V", label: "Copy / cut / paste" },
  { keys: "Ctrl + D", label: "Duplicate" },
  { keys: "Ctrl + A", label: "Select all" },
  { keys: "+ / −", label: "Zoom timeline in / out" },
  { keys: "Shift + Z", label: "Zoom to fit" },
  { keys: "N", label: "Toggle snapping" },
  { keys: "R", label: "Toggle ripple mode" },
  { keys: "T", label: "Add text at playhead" },
  { keys: "Ctrl + I", label: "Import media" },
  { keys: "Ctrl + S", label: "Save now" },
  { keys: "Ctrl + E", label: "Export video" },
  { keys: "F", label: "Full-screen preview" },
  { keys: "?", label: "Keyboard shortcuts" },
];

export function useShortcuts(opts: { importMedia: () => void; timelineWidth: () => number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,[contenteditable=true]")) return;
      // modal dialogs block shortcuts; the export queue is a floating, non-modal panel
      const { queue: _queue, ...modals } = useApp.getState().dialogs;
      if (Object.values(modals).some(Boolean) && e.key !== "Escape") return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const ui = useUi.getState();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (k === " ") return handled(), player.toggle();
      if (ctrl && (k === "z" || k === "Z")) return handled(), e.shiftKey ? useProject.getState().redo() : useProject.getState().undo();
      if (ctrl && (k === "y" || k === "Y")) return handled(), useProject.getState().redo();
      if (ctrl && (k === "c" || k === "C")) return handled(), A.copySelection();
      if (ctrl && (k === "x" || k === "X")) return handled(), A.copySelection(true);
      if (ctrl && (k === "v" || k === "V")) return handled(), A.paste();
      if (ctrl && (k === "d" || k === "D")) return handled(), A.duplicateSelection();
      if (ctrl && (k === "a" || k === "A")) return handled(), A.selectAll();
      if (ctrl && (k === "b" || k === "B")) return handled(), A.splitAtPlayhead();
      if (ctrl && (k === "i" || k === "I")) return handled(), opts.importMedia();
      if (ctrl && (k === "e" || k === "E")) return handled(), useApp.getState().openDialog("export");
      if (ctrl && (k === "s" || k === "S")) {
        handled();
        void useProject.getState().saveNow().then(() => useApp.getState().toast(i18n.t("Project saved"), "success"));
        return;
      }
      if (ctrl) return;
      if (k === "Delete" || k === "Backspace") return handled(), A.deleteSelection(e.shiftKey || ui.ripple);
      if (k === "ArrowLeft") return handled(), player.step(e.shiftKey ? -(useProject.getState().project?.settings.fps ?? 30) : -1);
      if (k === "ArrowRight") return handled(), player.step(e.shiftKey ? useProject.getState().project?.settings.fps ?? 30 : 1);
      if (k === "ArrowUp") return handled(), A.seekToEdge(-1);
      if (k === "ArrowDown") return handled(), A.seekToEdge(1);
      if (k === "Home") return handled(), player.seek(0);
      if (k === "End") return handled(), player.seek(Infinity);
      if (k === "s" || k === "S") return handled(), A.splitAtPlayhead();
      if (k === "+" || k === "=") return handled(), ui.setZoom(ui.zoom * 1.25);
      if (k === "-" || k === "_") return handled(), ui.setZoom(ui.zoom / 1.25);
      if (k === "Z" && e.shiftKey) return handled(), A.zoomToFit(opts.timelineWidth());
      if (k === "n" || k === "N") return handled(), ui.set({ snapping: !ui.snapping });
      if (k === "r" || k === "R") return handled(), ui.set({ ripple: !ui.ripple });
      if (k === "t" || k === "T") return handled(), A.addText(i18n.t("Your text"));
      if (k === "f" || k === "F") return handled(), ui.set({ previewFullscreen: !ui.previewFullscreen });
      if (k === "Escape") {
        if (ui.previewFullscreen) return handled(), ui.set({ previewFullscreen: false });
        return ui.select([]);
      }
      if (k === "?") return handled(), useApp.getState().openDialog("shortcuts");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts]);
}
