import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Archive, ArchiveRestore, Copy, Cpu, FileDown, FileUp, Film, Folder, FolderOpen, Languages, Pencil, Plus, Search, Settings, Trash2, TriangleAlert } from "lucide-react";
import { api, errorText, fileUrl, type ProjectMeta } from "../../backend/api";
import { ASPECT_PRESETS, FRAME_RATES, RESOLUTIONS, sizeFor } from "../../engine/presets";
import { shortTime } from "../../lib/time";
import { applyLanguage } from "../../i18n";
import { useApp } from "../../store/appStore";
import { duplicateProject, exportProjectFile, importProjectFile, newProject, openProject } from "../../services/projects";
import { Button, Modal, Row, Select, confirmAction, cx, openContextMenu, promptText } from "../common/ui";

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(t("Untitled project"));
  const [aspect, setAspect] = useState("16:9");
  const [res, setRes] = useState(1080);
  const [fps, setFps] = useState(30);
  const preset = ASPECT_PRESETS.find((a) => a.id === aspect)!;
  const size = sizeFor(preset.width, preset.height, res);
  const create = async () => {
    try {
      await newProject(name, { width: size.width, height: size.height, fps });
    } catch (e) {
      useApp.getState().toast(errorText(e), "error");
    }
  };
  return (
    <Modal
      title={t("New project")}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={create}>
            {t("Create project")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Row label={t("Name")}>
          <input
            autoFocus
            dir="auto"
            className="h-9 w-full rounded-md border border-line-2 bg-panel-2 px-3 outline-none focus:border-accent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </Row>
        <div>
          <div className="mb-2 text-[12px] text-muted">{t("Aspect ratio")}</div>
          <div className="grid grid-cols-6 gap-2">
            {ASPECT_PRESETS.map((a) => {
              const r = a.width / a.height;
              const bw = r >= 1 ? 40 : 40 * r;
              const bh = r >= 1 ? 40 / r : 40;
              return (
                <button
                  key={a.id}
                  onClick={() => setAspect(a.id)}
                  className={cx("flex flex-col items-center gap-2 rounded-lg border p-2.5", aspect === a.id ? "border-accent bg-accent/10" : "border-line-2 hover:border-line-2 hover:bg-panel-3")}
                >
                  <div className="flex h-11 items-center">
                    <div className="rounded-sm border-2 border-current text-violet-300" style={{ width: bw, height: bh }} />
                  </div>
                  <span className="text-[12px]">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Row label={t("Resolution")}>
            <Select value={res} onChange={setRes} options={RESOLUTIONS.slice(0, 5).map((r) => ({ value: r.short, label: r.id }))} />
          </Row>
          <Row label={t("Frame rate")}>
            <Select value={fps} onChange={setFps} options={FRAME_RATES.map((f) => ({ value: f, label: `${f} fps` }))} />
          </Row>
        </div>
        <div className="text-[12px] text-muted" dir="ltr">
          {size.width} × {size.height} · {fps} fps
        </div>
      </div>
    </Modal>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [filter, setFilter] = useState<{ kind: "all" | "archived" | "folder"; folder?: string }>({ kind: "all" });
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const info = useApp((s) => s.info);
  const system = useApp((s) => s.system);
  const language = useApp((s) => s.language);
  const toast = useApp((s) => s.toast);

  const refresh = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      toast(errorText(e), "error");
    }
  }, [toast]);
  useEffect(() => void refresh(), [refresh]);

  const folders = useMemo(() => [...new Set(projects.filter((p) => p.folder && !p.archived).map((p) => p.folder))].sort(), [projects]);
  const shown = projects.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter.kind === "archived") return p.archived;
    if (p.archived) return false;
    if (filter.kind === "folder") return p.folder === filter.folder;
    return true;
  });

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      toast(errorText(e), "error");
    }
    await refresh();
  };

  const menu = (e: React.MouseEvent, p: ProjectMeta) =>
    openContextMenu(e, [
      { label: t("Open"), icon: <FolderOpen size={14} />, onClick: () => void openProject(p.id) },
      {
        label: t("Rename"),
        icon: <Pencil size={14} />,
        onClick: async () => {
          const n = await promptText(t("Rename project"), p.name);
          if (n) await run(() => api.renameProject(p.id, n));
        },
      },
      { label: t("Duplicate"), icon: <Copy size={14} />, onClick: () => void run(() => duplicateProject(p.id, `${p.name} (${t("copy")})`)) },
      {
        label: t("Move to folder…"),
        icon: <Folder size={14} />,
        onClick: async () => {
          const f = await promptText(t("Folder name (empty = none)"), p.folder);
          if (f !== null) await run(() => api.setFolder(p.id, f));
        },
      },
      p.archived
        ? { label: t("Restore from archive"), icon: <ArchiveRestore size={14} />, onClick: () => void run(() => api.setArchived(p.id, false)) }
        : { label: t("Archive"), icon: <Archive size={14} />, onClick: () => void run(() => api.setArchived(p.id, true)) },
      {
        label: t("Export project file…"),
        icon: <FileDown size={14} />,
        onClick: async () => {
          const path = await saveDialog({ defaultPath: `${p.name}.sxproj`, filters: [{ name: "StudioX Project", extensions: ["sxproj"] }] });
          if (path) await run(async () => {
            await exportProjectFile(p.id, path);
            toast(t("Project file saved"), "success");
          });
        },
      },
      { separator: true },
      {
        label: t("Delete"),
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: async () => {
          if (await confirmAction(t("Delete project"), t("Delete “{{name}}” permanently? Media files on disk are not affected.", { name: p.name }), true)) await run(() => api.deleteProject(p.id));
        },
      },
    ]);

  const importFile = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "StudioX Project", extensions: ["sxproj", "json"] }] });
    if (typeof path === "string") await run(async () => openProject(await importProjectFile(path)));
  };

  const switchLang = async () => {
    const l = language === "en" ? "ar" : "en";
    applyLanguage(l);
    useApp.getState().set({ language: l });
    await api.setSetting("language", l);
  };

  const navItem = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void, count?: number) => (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2.5 rounded-md px-3 h-8 text-start", active ? "bg-accent/15 text-violet-200" : "text-muted hover:bg-panel-3 hover:text-fg")}>
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] text-dim">{count}</span>}
    </button>
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-[240px] shrink-0 flex-col border-e border-line bg-panel">
        <div className="flex items-center gap-2.5 px-4 h-14">
          <img src="/logo.png" className="size-8 rounded-lg" />
          <div className="leading-tight">
            <div className="font-bold tracking-wide">
              STUDIOX <span className="grad-text">AI</span>
            </div>
            <div className="text-[10.5px] text-dim">v{info?.version}</div>
          </div>
        </div>
        <nav className="space-y-0.5 px-2 py-2">
          {navItem(filter.kind === "all", t("All projects"), <Film size={15} />, () => setFilter({ kind: "all" }), projects.filter((p) => !p.archived).length)}
          {folders.map((f) => navItem(filter.kind === "folder" && filter.folder === f, f, <Folder size={15} />, () => setFilter({ kind: "folder", folder: f }), projects.filter((p) => p.folder === f && !p.archived).length))}
          {navItem(filter.kind === "archived", t("Archived"), <Archive size={15} />, () => setFilter({ kind: "archived" }), projects.filter((p) => p.archived).length)}
        </nav>
        <div className="mt-auto space-y-2 p-3">
          {info && !info.ffmpeg.found && (
            <button onClick={() => useApp.getState().openDialog("settings")} className="flex w-full items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-start text-[12px] text-amber-200">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              {t("FFmpeg was not found. Click to configure it in Settings.")}
            </button>
          )}
          {system && (
            <div className="rounded-lg border border-line bg-panel-2 p-2.5 text-[11.5px] text-muted">
              <div className="mb-1 flex items-center gap-1.5 text-fg">
                <Cpu size={13} />
                {t("Performance profile")}: <b className="text-violet-200">{t(system.profile === "low" ? "Low-end" : system.profile === "high" ? "High performance" : "Balanced")}</b>
              </div>
              <div className="truncate" title={system.cpu}>
                {system.cpu}
              </div>
              <div dir="ltr" className="text-start">
                {Math.round(system.ramMb / 1024)} GB RAM · {system.cpuCores}C/{system.cpuThreads}T
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <Button variant="ghost" className="flex-1" onClick={switchLang}>
              <Languages size={15} />
              {language === "en" ? "العربية" : "English"}
            </Button>
            <Button variant="ghost" onClick={() => useApp.getState().openDialog("settings")} title={t("Settings")}>
              <Settings size={15} />
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-6 h-14">
          <h1 className="text-[17px] font-semibold">{filter.kind === "archived" ? t("Archived") : filter.kind === "folder" ? filter.folder : t("All projects")}</h1>
          <div className="ms-auto flex h-8 w-[260px] items-center gap-2 rounded-md border border-line-2 bg-panel-2 px-2.5">
            <Search size={14} className="text-dim" />
            <input type="search" dir="auto" placeholder={t("Search projects")} className="w-full bg-transparent outline-none" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button onClick={importFile}>
            <FileUp size={15} />
            {t("Import project")}
          </Button>
          <Button variant="primary" onClick={() => setShowNew(true)}>
            <Plus size={15} />
            {t("New project")}
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-6">
          {shown.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="grad-bg flex size-16 items-center justify-center rounded-2xl">
                <Film size={30} className="text-white" />
              </div>
              <div className="text-[16px] font-semibold">{projects.length ? t("No projects here") : t("Create your first project")}</div>
              <p className="max-w-sm text-muted">{t("Import videos, audio and images, edit them on a multi-track timeline and export real video files — all offline.")}</p>
              <Button variant="primary" onClick={() => setShowNew(true)}>
                <Plus size={15} />
                {t("New project")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {shown.map((p) => (
                <button key={p.id} onClick={() => void openProject(p.id)} onContextMenu={(e) => menu(e, p)} className="group text-start">
                  <div className="checker relative aspect-video overflow-hidden rounded-lg border border-line ring-accent transition group-hover:ring-2">
                    {p.thumbnail ? <img src={fileUrl(p.thumbnail)} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-dim"><Film size={28} /></div>}
                    <span className="absolute bottom-1.5 end-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10.5px] tabular-nums" dir="ltr">
                      {shortTime(p.duration)}
                    </span>
                  </div>
                  <div className="mt-2 truncate font-medium" dir="auto">
                    {p.name}
                  </div>
                  <div className="text-[11.5px] text-dim">
                    <span dir="ltr">{p.width}×{p.height}</span> · {new Date(p.updatedAt).toLocaleString(language === "ar" ? "ar" : "en")}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}
