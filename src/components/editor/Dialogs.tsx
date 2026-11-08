import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderSearch, History, Link2, RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import { api, errorText, type BackupMeta } from "../../backend/api";
import { ASPECT_PRESETS, FRAME_RATES } from "../../engine/presets";
import { formatBytes } from "../../lib/time";
import { MEDIA_EXTENSIONS, relinkFromFolder, relinkMedia } from "../../services/media";
import { restoreVersion, saveNamedVersion } from "../../services/projects";
import { SHORTCUTS } from "../../hooks/useShortcuts";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { Button, Modal, NumberField, Row, Select, confirmAction, promptText } from "../common/ui";

const closer = (d: "history" | "shortcuts" | "relink" | "projectSettings") => () => useApp.getState().openDialog(d, false);

export function HistoryDialog() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const past = useProject((s) => s.past);
  const [list, setList] = useState<BackupMeta[]>([]);
  const language = useApp((s) => s.language);
  const refresh = () => void api.listBackups(project.id).then(setList).catch((e) => useApp.getState().toast(errorText(e), "error"));
  useEffect(refresh, [project.id]);
  return (
    <Modal title={t("Version history")} onClose={closer("history")} width={620}>
      <div className="mb-4 flex gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            const n = await promptText(t("Save named version"), `${t("Version")} ${new Date().toLocaleString(language)}`);
            if (n !== null) {
              await saveNamedVersion(n);
              refresh();
            }
          }}
        >
          <Save size={14} />
          {t("Save named version")}
        </Button>
        <p className="text-[12px] leading-snug text-dim">{t("Automatic backups are created every 5 minutes while you edit (the last 30 are kept). Restoring is undoable.")}</p>
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Saved versions")}</div>
      <div className="space-y-1">
        {list.length === 0 && <p className="text-[12px] text-dim">{t("No versions yet.")}</p>}
        {list.map((b) => (
          <div key={b.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <History size={14} className={b.kind === "named" ? "text-violet-300" : "text-dim"} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px]" dir="auto">
                {b.kind === "named" ? b.label : t("Automatic backup")}
              </div>
              <div className="text-[11px] text-dim">
                {new Date(b.createdAt).toLocaleString(language)} · {formatBytes(b.size)}
              </div>
            </div>
            <Button
              onClick={async () => {
                if (await confirmAction(t("Restore version"), t("Replace the current timeline with this version? You can undo it."))) {
                  await restoreVersion(b.id);
                  closer("history")();
                }
              }}
            >
              <RotateCcw size={13} />
              {t("Restore")}
            </Button>
            <Button variant="ghost" onClick={async () => (await api.deleteBackup(b.id), refresh())} title={t("Delete")}>
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
      </div>
      <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Editing history (this session)")}</div>
      <div className="max-h-48 space-y-0.5 overflow-auto text-[12px]">
        {past.length === 0 && <p className="text-dim">{t("No edits yet.")}</p>}
        {[...past].reverse().map((h, i) => (
          <div key={i} className="flex justify-between rounded px-2 py-1 odd:bg-panel-2">
            <span>{h.label}</span>
            <span className="text-dim">{new Date(h.at).toLocaleTimeString(language)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ProjectSettingsDialog() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const [w, setW] = useState(project.settings.width);
  const [h, setH] = useState(project.settings.height);
  const [fps, setFps] = useState(project.settings.fps);
  const apply = () => {
    useProject.getState().commit(t("Project settings"), (d) => {
      d.settings.width = Math.max(16, Math.round(w / 2) * 2);
      d.settings.height = Math.max(16, Math.round(h / 2) * 2);
      d.settings.fps = fps;
    });
    closer("projectSettings")();
  };
  return (
    <Modal
      title={t("Project settings")}
      onClose={closer("projectSettings")}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={closer("projectSettings")}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={apply}>
            {t("Apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_PRESETS.map((a) => (
            <Button key={a.id} onClick={() => (setW(a.width), setH(a.height))}>
              {a.label}
            </Button>
          ))}
        </div>
        <Row label={t("Canvas size")}>
          <NumberField value={w} onChange={setW} min={16} max={8192} precision={0} />
          <span className="text-dim">×</span>
          <NumberField value={h} onChange={setH} min={16} max={8192} precision={0} />
        </Row>
        <Row label={t("Frame rate")}>
          <Select value={fps} onChange={setFps} options={FRAME_RATES.map((f) => ({ value: f, label: `${f} fps` }))} />
        </Row>
        <p className="text-[12px] text-dim">{t("Changing the canvas keeps every clip; media is re-fitted to the new frame.")}</p>
      </div>
    </Modal>
  );
}

export function RelinkDialog() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const missing = project.media.filter((m) => m.missing);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!missing.length) closer("relink")();
  }, [missing.length]);
  return (
    <Modal
      title={t("Missing media")}
      onClose={closer("relink")}
      width={620}
      footer={
        <>
          <Button
            disabled={busy}
            onClick={async () => {
              const dir = await openDialog({ directory: true });
              if (typeof dir !== "string") return;
              setBusy(true);
              const n = await relinkFromFolder(dir);
              setBusy(false);
              useApp.getState().toast(t("Relinked {{n}} file(s)", { n }), n ? "success" : "info");
            }}
          >
            <FolderSearch size={14} />
            {t("Search a folder…")}
          </Button>
          <Button variant="ghost" onClick={closer("relink")}>
            {t("Later")}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-[12px] text-amber-200">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
        {t("These files were moved, renamed or deleted. Point StudioX AI to their new location — your edits are kept.")}
      </div>
      <div className="space-y-1.5">
        {missing.map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px]" dir="auto">
                {m.name}
              </div>
              <div className="truncate text-[11px] text-dim" dir="ltr" title={m.path}>
                {m.path}
              </div>
            </div>
            <Button
              onClick={async () => {
                const f = await openDialog({ multiple: false, filters: [{ name: t("Media files"), extensions: MEDIA_EXTENSIONS }] });
                if (typeof f === "string") await relinkMedia(m.id, f);
              }}
            >
              <Link2 size={13} />
              {t("Locate…")}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ShortcutsDialog() {
  const { t } = useTranslation();
  return (
    <Modal title={t("Keyboard shortcuts")} onClose={closer("shortcuts")} width={560}>
      <div className="grid grid-cols-1 gap-x-6">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between border-b border-line/60 py-1.5">
            <span className="text-[12.5px]">{t(s.label)}</span>
            <kbd className="rounded border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-muted" dir="ltr">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}
