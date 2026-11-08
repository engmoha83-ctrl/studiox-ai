import { api, errorText } from "../backend/api";
import { createProject } from "../engine/defaults";
import { uid } from "../lib/id";
import { app } from "../store/appStore";
import { getProject, serializeProject, useProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";
import { PROJECT_FORMAT, PROJECT_VERSION, type Project, type ProjectSettings } from "../types/project";
import { checkMissing, prepareAsset } from "./media";
import i18n from "../i18n";

/** Validate + migrate a parsed project document. Throws on invalid input. */
export function parseProject(json: string): Project {
  const p = JSON.parse(json) as Project;
  if (!p || p.format !== PROJECT_FORMAT) throw new Error(i18n.t("This is not a StudioX AI project file."));
  if (typeof p.version !== "number" || p.version > PROJECT_VERSION) throw new Error(i18n.t("This project was created by a newer version of StudioX AI."));
  p.media ??= [];
  p.mediaFolders ??= [];
  p.tracks ??= [];
  p.clips ??= {};
  p.markers ??= [];
  return p;
}

export async function newProject(name: string, settings: Partial<ProjectSettings>) {
  const p = createProject(name.trim() || i18n.t("Untitled project"), settings);
  await api.saveProject(serializeProject(p));
  await openProjectDoc(p);
}

async function openProjectDoc(p: Project) {
  useProject.getState().open(p);
  useUi.getState().set({ playhead: 0, playing: false, selection: [], selectedMediaId: null });
  app().set({ screen: "editor", filmstrips: {}, waveforms: {} });
  const missing = await checkMissing();
  if (missing > 0) app().openDialog("relink");
  for (const m of getProject()?.media ?? []) if (!m.missing && (!m.thumbnail || m.proxyState !== "ready")) void prepareAsset(m.id);
}

export async function openProject(id: string) {
  try {
    const p = parseProject(await api.loadProject(id));
    await openProjectDoc(p);
  } catch (e) {
    app().toast(errorText(e), "error");
  }
}

export async function closeProject() {
  await useProject.getState().saveNow();
  useProject.getState().close();
  app().set({ screen: "home" });
}

export async function duplicateProject(id: string, name: string) {
  await api.duplicateProject(id, uid("prj"), name);
}

/** Write a portable .sxproj file (JSON; media referenced by absolute path, never embedded). */
export async function exportProjectFile(id: string, path: string) {
  const data = getProject()?.id === id ? serializeProject(getProject()!) : await api.loadProject(id);
  await api.writeTextFile(path, JSON.stringify(JSON.parse(data), null, 2));
}

export async function importProjectFile(path: string): Promise<string> {
  const p = parseProject(await api.readTextFile(path));
  const existing = await api.listProjects();
  if (existing.some((x) => x.id === p.id)) {
    p.id = uid("prj");
    p.name = `${p.name} (${i18n.t("imported")})`;
  }
  await api.saveProject(serializeProject(p));
  return p.id;
}

export async function saveNamedVersion(label: string) {
  const p = getProject();
  if (!p) return;
  await useProject.getState().saveNow();
  await api.addBackup(p.id, label || i18n.t("Named version"), "named", serializeProject(p));
}

export async function restoreVersion(backupId: number) {
  const p = getProject();
  if (!p) return;
  const restored = parseProject(await api.getBackup(backupId));
  restored.id = p.id; // restore in place, undoable
  useProject.getState().replace(restored, i18n.t("Restore version"));
  await checkMissing();
}
