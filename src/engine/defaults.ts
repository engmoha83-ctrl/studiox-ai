import { uid } from "../lib/id";
import { snapFrame } from "../lib/time";
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type MediaAsset,
  type MediaClip,
  type Project,
  type ProjectSettings,
  type TextClip,
  type TextStyle,
  type Track,
  type TrackKind,
} from "../types/project";

export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_TEXT_DURATION = 4;

export function defaultSettings(partial: Partial<ProjectSettings> = {}): ProjectSettings {
  return { width: 1920, height: 1080, fps: 30, background: "#000000", sampleRate: 48000, ...partial };
}

export function makeTrack(kind: TrackKind, name: string): Track {
  return { id: uid("trk"), kind, name, locked: false, hidden: false, muted: false, volume: 1 };
}

export function createProject(name: string, settings: Partial<ProjectSettings> = {}): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: uid("prj"),
    name,
    createdAt: Date.now(),
    settings: defaultSettings(settings),
    media: [],
    mediaFolders: [],
    tracks: [makeTrack("text", "T1"), makeTrack("video", "V2"), makeTrack("video", "V1"), makeTrack("audio", "A1"), makeTrack("audio", "A2")],
    clips: {},
    markers: [],
  };
}

export function defaultTextStyle(partial: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: "Cairo",
    fontSize: 96,
    fontWeight: 700,
    italic: false,
    color: "#ffffff",
    align: "center",
    lineHeight: 1.25,
    letterSpacing: 0,
    outlineColor: "#000000",
    outlineWidth: 0,
    shadowColor: "#000000",
    shadowBlur: 12,
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    backgroundPadding: 24,
    backgroundRadius: 16,
    x: 0.5,
    y: 0.5,
    maxWidth: 0.9,
    direction: "auto",
    arabicDigits: false,
    ...partial,
  };
}

export function makeMediaClip(media: MediaAsset, trackId: string, start: number, fps: number): MediaClip {
  const duration = media.kind === "image" ? DEFAULT_IMAGE_DURATION : snapFrame(media.duration, fps) || 1 / fps;
  return {
    id: uid("clp"),
    type: "media",
    trackId,
    mediaId: media.id,
    name: media.name,
    start: snapFrame(start, fps),
    duration,
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    opacity: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    audioFadeIn: 0,
    audioFadeOut: 0,
    transitionIn: null,
    transitionOut: null,
  };
}

export function makeTextClip(trackId: string, start: number, text: string, style: Partial<TextStyle> = {}, duration = DEFAULT_TEXT_DURATION): TextClip {
  return {
    id: uid("clp"),
    type: "text",
    trackId,
    start,
    duration,
    text,
    style: defaultTextStyle(style),
    opacity: 1,
    animIn: "fade",
    animOut: "fade",
    animDuration: 0.4,
    transitionIn: null,
    transitionOut: null,
  };
}
