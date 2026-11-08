// Project state + undo/redo command history + autosave.
import { create } from "zustand";
import { produce, setAutoFreeze } from "immer";
import type { Project } from "../types/project";
import { api, errorText } from "../backend/api";

setAutoFreeze(true);

export interface HistoryEntry {
  label: string;
  before: Project;
  key?: string;
  at: number;
}

export type SaveState = "saved" | "saving" | "unsaved" | "error";

interface ProjectStore {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  saveState: SaveState;
  saveError?: string;
  lastSavedAt?: number;
  open: (p: Project) => void;
  close: () => void;
  /** Apply an undoable command. `coalesce` merges rapid edits with the same key (e.g. slider drags). */
  commit: (label: string, recipe: (draft: Project) => void, coalesce?: string) => void;
  /** Mutate without history (runtime caches such as thumbnails/proxy paths). */
  patch: (recipe: (draft: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  replace: (p: Project, label: string) => void;
  saveNow: () => Promise<void>;
}

const MAX_HISTORY = 300;
const COALESCE_MS = 900;
const AUTOSAVE_MS = 1500;
const BACKUP_EVERY_MS = 5 * 60 * 1000;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastBackupAt = 0;

/** Strip runtime-only state before persisting. */
export function serializeProject(p: Project): string {
  const clean = produce(p, (d) => {
    for (const m of d.media) {
      delete m.missing;
      if (m.proxyState === "pending") m.proxyState = "none";
    }
  });
  return JSON.stringify(clean);
}

export const useProject = create<ProjectStore>((set, get) => {
  const scheduleSave = () => {
    set({ saveState: "unsaved" });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), AUTOSAVE_MS);
  };
  return {
    project: null,
    past: [],
    future: [],
    saveState: "saved",
    open: (p) => {
      clearTimeout(saveTimer);
      lastBackupAt = Date.now();
      set({ project: p, past: [], future: [], saveState: "saved", saveError: undefined });
    },
    close: () => {
      clearTimeout(saveTimer);
      set({ project: null, past: [], future: [] });
    },
    commit: (label, recipe, coalesce) => {
      const cur = get().project;
      if (!cur) return;
      const next = produce(cur, recipe);
      if (next === cur) return;
      const past = get().past;
      const last = past[past.length - 1];
      const now = Date.now();
      if (coalesce && last && last.key === coalesce && now - last.at < COALESCE_MS) {
        set({ project: next, past: [...past.slice(0, -1), { ...last, at: now }], future: [] });
      } else {
        const entry: HistoryEntry = { label, before: cur, key: coalesce, at: now };
        set({ project: next, past: [...past, entry].slice(-MAX_HISTORY), future: [] });
      }
      scheduleSave();
    },
    patch: (recipe) => {
      const cur = get().project;
      if (!cur) return;
      const next = produce(cur, recipe);
      if (next === cur) return;
      // keep history snapshots consistent with runtime caches
      set({ project: next });
      scheduleSave();
    },
    undo: () => {
      const { past, project, future } = get();
      if (!past.length || !project) return;
      const e = past[past.length - 1];
      set({ project: carryCaches(e.before, project), past: past.slice(0, -1), future: [{ ...e, before: project }, ...future] });
      scheduleSave();
    },
    redo: () => {
      const { past, project, future } = get();
      if (!future.length || !project) return;
      const e = future[0];
      set({ project: carryCaches(e.before, project), future: future.slice(1), past: [...past, { ...e, before: project }] });
      scheduleSave();
    },
    replace: (p, label) => {
      const cur = get().project;
      if (!cur) return;
      set({ project: p, past: [...get().past, { label, before: cur, at: Date.now() }].slice(-MAX_HISTORY), future: [] });
      scheduleSave();
    },
    saveNow: async () => {
      const p = get().project;
      if (!p) return;
      clearTimeout(saveTimer);
      set({ saveState: "saving" });
      try {
        const data = serializeProject(p);
        const thumb = p.media.find((m) => m.thumbnail && m.kind !== "audio")?.thumbnail ?? null;
        await api.saveProject(data, thumb);
        if (Date.now() - lastBackupAt > BACKUP_EVERY_MS) {
          lastBackupAt = Date.now();
          await api.addBackup(p.id, "Autosave", "auto", data);
        }
        if (get().project?.id === p.id) set({ saveState: get().project === p ? "saved" : "unsaved", lastSavedAt: Date.now(), saveError: undefined });
      } catch (e) {
        set({ saveState: "error", saveError: errorText(e) });
      }
    },
  };
});

/** Undo/redo must not lose runtime media caches (thumbnails, proxies) produced meanwhile. */
function carryCaches(target: Project, from: Project): Project {
  return produce(target, (d) => {
    for (const m of d.media) {
      const src = from.media.find((x) => x.id === m.id);
      if (!src) continue;
      m.thumbnail = src.thumbnail;
      m.proxyPath = src.proxyPath;
      m.proxyState = src.proxyState;
      m.missing = src.missing;
      m.path = src.path;
    }
  });
}

/** Convenience non-hook accessors */
export const getProject = () => useProject.getState().project;
export const commit = (label: string, recipe: (d: Project) => void, coalesce?: string) => useProject.getState().commit(label, recipe, coalesce);
