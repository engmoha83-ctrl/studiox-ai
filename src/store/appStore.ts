import { create } from "zustand";
import type { AppInfo, EncoderCaps, Filmstrip, SystemInfo, Waveform } from "../backend/api";
import type { ExportSettings } from "../engine/presets";

export type Screen = "home" | "editor";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export type JobStatus = "queued" | "preparing" | "running" | "done" | "error" | "cancelled";

export interface ExportJob {
  id: string;
  name: string;
  outputPath: string;
  status: JobStatus;
  progress: number;
  eta?: number | null;
  fps?: number;
  speed?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  settings: ExportSettings;
  projectId: string;
}

interface AppStore {
  screen: Screen;
  language: "en" | "ar";
  info?: AppInfo;
  system?: SystemInfo;
  caps?: EncoderCaps;
  toasts: Toast[];
  exports: ExportJob[];
  filmstrips: Record<string, Filmstrip | "loading" | "error">;
  waveforms: Record<string, Waveform | "loading" | "error">;
  dialogs: { export: boolean; settings: boolean; history: boolean; shortcuts: boolean; relink: boolean; projectSettings: boolean; queue: boolean };
  autoProxy: boolean;
  set: (p: Partial<AppStore>) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
  openDialog: (d: keyof AppStore["dialogs"], open?: boolean) => void;
  updateExport: (id: string, p: Partial<ExportJob>) => void;
}

let toastId = 1;

export const useApp = create<AppStore>((set, get) => ({
  screen: "home",
  language: "en",
  toasts: [],
  exports: [],
  filmstrips: {},
  waveforms: {},
  dialogs: { export: false, settings: false, history: false, shortcuts: false, relink: false, projectSettings: false, queue: false },
  autoProxy: true,
  set: (p) => set(p),
  toast: (text, kind = "info") => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 9000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  openDialog: (d, open = true) => set({ dialogs: { ...get().dialogs, [d]: open } }),
  updateExport: (id, p) => set({ exports: get().exports.map((j) => (j.id === id ? { ...j, ...p } : j)) }),
}));

export const app = () => useApp.getState();
