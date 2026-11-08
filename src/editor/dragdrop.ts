// In-app drag & drop (library → timeline, templates → timeline, transitions → clip edges).
// Implemented with pointer events instead of HTML5 DnD: on Windows the WebView2 host
// intercepts HTML5 drag events while OS file-drop is enabled, so native DnD never fires.
import { create } from "zustand";
import type { TextStyle, TransitionType } from "../types/project";
import { getProject } from "../store/projectStore";
import { snapFrame } from "../lib/time";
import { addMediaToTimeline, addText, applyTransition } from "./actions";

export type DragPayload =
  | { kind: "media"; id: string }
  | { kind: "text"; text: string; style: Partial<TextStyle>; duration?: number }
  | { kind: "transition"; type: TransitionType; duration: number };

export interface DropTarget {
  time: number;
  trackId: string;
}

interface DragStore {
  payload: DragPayload | null;
  label: string;
  x: number;
  y: number;
  hint: DropTarget | null;
  clipHint: { id: string; edge: "in" | "out" } | null;
}
export const useDrag = create<DragStore>(() => ({ payload: null, label: "", x: 0, y: 0, hint: null, clipHint: null }));

/** Registered by the timeline: maps a screen point to a time + track (or null). */
let resolveTarget: (x: number, y: number) => DropTarget | null = () => null;
export function registerDropResolver(f: (x: number, y: number) => DropTarget | null) {
  resolveTarget = f;
}

function clipUnder(x: number, y: number): { id: string; edge: "in" | "out" } | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-clip]") as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.dataset.clip!, edge: x - r.left < r.width / 2 ? "in" : "out" };
}

/** Call from onPointerDown of a draggable source. A plain click is left untouched. */
export function beginDrag(e: React.PointerEvent, payload: DragPayload, label: string) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!active) {
      active = true;
      document.body.style.cursor = "copy";
    }
    const hint = payload.kind === "transition" ? null : resolveTarget(ev.clientX, ev.clientY);
    const clipHint = payload.kind === "transition" ? clipUnder(ev.clientX, ev.clientY) : null;
    useDrag.setState({ payload, label, x: ev.clientX, y: ev.clientY, hint, clipHint });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.style.cursor = "";
    useDrag.setState({ payload: null, hint: null, clipHint: null });
    if (!active) return;
    drop(payload, ev.clientX, ev.clientY);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function drop(payload: DragPayload, x: number, y: number) {
  if (payload.kind === "transition") {
    const c = clipUnder(x, y);
    if (c) applyTransition(payload.type, c.edge, payload.duration, [c.id]);
    return;
  }
  const target = resolveTarget(x, y);
  if (!target) return;
  const fps = getProject()?.settings.fps ?? 30;
  const time = snapFrame(target.time, fps);
  if (payload.kind === "media") {
    const m = getProject()?.media.find((x) => x.id === payload.id);
    if (m) addMediaToTimeline(m, time, target.trackId);
  } else addText(payload.text, payload.style, payload.duration, time);
}
