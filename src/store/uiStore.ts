import { create } from "zustand";
import type { Clip } from "../types/project";

export type LeftTab = "media" | "audio" | "text" | "transitions" | "ai";

interface UiStore {
  playhead: number;
  playing: boolean;
  /** pixels per second */
  zoom: number;
  selection: string[];
  selectedMediaId: string | null;
  snapping: boolean;
  ripple: boolean;
  previewQuality: 1 | 0.5 | 0.25;
  playbackRate: number;
  safeArea: boolean;
  leftTab: LeftTab;
  clipboard: Clip[];
  previewFullscreen: boolean;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  set: (p: Partial<UiStore>) => void;
}

export const MIN_ZOOM = 0.02; // px per second → fits ~14 hours in 1000 px
export const MAX_ZOOM = 2000;

export const useUi = create<UiStore>((set) => ({
  playhead: 0,
  playing: false,
  zoom: 60,
  selection: [],
  selectedMediaId: null,
  snapping: true,
  ripple: false,
  previewQuality: 1,
  playbackRate: 1,
  safeArea: false,
  leftTab: "media",
  clipboard: [],
  previewFullscreen: false,
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (z) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) }),
  select: (ids) => set({ selection: ids }),
  toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
  set: (p) => set(p),
}));

export const ui = () => useUi.getState();
