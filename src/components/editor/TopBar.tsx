import { useTranslation } from "react-i18next";
import { CircleCheck, CloudOff, Download, History, House, Keyboard, Languages, LoaderCircle, Redo2, Save, Settings, SlidersHorizontal, Undo2, Upload } from "lucide-react";
import { api } from "../../backend/api";
import { applyLanguage } from "../../i18n";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { closeProject } from "../../services/projects";
import { Button, IconBtn, Tooltip, promptText } from "../common/ui";

export default function TopBar({ importMedia }: { importMedia: () => void }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const saveState = useProject((s) => s.saveState);
  const saveError = useProject((s) => s.saveError);
  const past = useProject((s) => s.past);
  const future = useProject((s) => s.future);
  const { undo, redo, commit, saveNow } = useProject.getState();
  const language = useApp((s) => s.language);
  const openDialog = useApp((s) => s.openDialog);

  const rename = async () => {
    const n = await promptText(t("Rename project"), project.name);
    if (n && n.trim()) commit(t("Rename project"), (d) => void (d.name = n.trim()));
  };
  const switchLang = async () => {
    const l = language === "en" ? "ar" : "en";
    applyLanguage(l);
    useApp.getState().set({ language: l });
    await api.setSetting("language", l);
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <IconBtn tip={t("Projects")} onClick={() => void closeProject()}>
        <House size={16} />
      </IconBtn>
      <img src="/logo.png" className="mx-1 size-6 rounded-md" />
      <button className="max-w-[280px] truncate rounded px-1.5 py-0.5 font-semibold hover:bg-panel-3" dir="auto" onClick={rename} title={t("Rename project")}>
        {project.name}
      </button>
      <Tooltip text={saveState === "error" ? `${t("Save failed")}: ${saveError}` : saveState === "saved" ? t("All changes saved") : t("Saving…")}>
        <span className="ms-1 flex items-center gap-1 text-[11.5px] text-dim">
          {saveState === "saved" && <CircleCheck size={13} className="text-emerald-400" />}
          {(saveState === "saving" || saveState === "unsaved") && <LoaderCircle size={13} className="animate-spin" />}
          {saveState === "error" && <CloudOff size={13} className="text-red-400" />}
          {saveState === "saved" ? t("Saved") : saveState === "error" ? t("Not saved") : t("Saving…")}
        </span>
      </Tooltip>
      <div className="mx-2 h-5 w-px bg-line" />
      <IconBtn tip={past.length ? `${t("Undo")}: ${past[past.length - 1].label}` : t("Undo")} shortcut="Ctrl+Z" onClick={undo} disabled={!past.length}>
        <Undo2 size={16} />
      </IconBtn>
      <IconBtn tip={future.length ? `${t("Redo")}: ${future[0].label}` : t("Redo")} shortcut="Ctrl+Y" onClick={redo} disabled={!future.length}>
        <Redo2 size={16} />
      </IconBtn>
      <IconBtn tip={t("Save now")} shortcut="Ctrl+S" onClick={() => void saveNow().then(() => useApp.getState().toast(t("Project saved"), "success"))}>
        <Save size={16} />
      </IconBtn>
      <IconBtn tip={t("Import media")} shortcut="Ctrl+I" onClick={importMedia}>
        <Upload size={16} />
      </IconBtn>
      <div className="flex-1" />
      <span className="me-2 text-[11.5px] text-dim tabular-nums" dir="ltr">
        {project.settings.width}×{project.settings.height} · {project.settings.fps} fps
      </span>
      <IconBtn tip={t("Project settings")} onClick={() => openDialog("projectSettings")}>
        <SlidersHorizontal size={16} />
      </IconBtn>
      <IconBtn tip={t("Version history")} onClick={() => openDialog("history")}>
        <History size={16} />
      </IconBtn>
      <IconBtn tip={t("Keyboard shortcuts")} shortcut="?" onClick={() => openDialog("shortcuts")}>
        <Keyboard size={16} />
      </IconBtn>
      <IconBtn tip={language === "en" ? "العربية" : "English"} onClick={switchLang}>
        <Languages size={16} />
      </IconBtn>
      <IconBtn tip={t("Settings")} onClick={() => openDialog("settings")}>
        <Settings size={16} />
      </IconBtn>
      <Button variant="primary" className="ms-2" onClick={() => openDialog("export")}>
        <Download size={15} />
        {t("Export")}
      </Button>
    </header>
  );
}
