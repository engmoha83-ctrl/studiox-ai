// STUDIOX AI project document model. See docs/PROJECT_FORMAT.md.

export const PROJECT_FORMAT = "studiox-project";
export const PROJECT_VERSION = 1;

export type MediaKind = "video" | "audio" | "image";
export type TrackKind = "video" | "audio" | "text";

export interface MediaAsset {
  id: string;
  path: string;
  name: string;
  kind: MediaKind;
  /** seconds; 0 for images */
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec?: string | null;
  audioCodec?: string | null;
  formatName?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  size: number;
  mtime: number;
  addedAt: number;
  lastUsedAt?: number;
  folderId?: string | null;
  favorite?: boolean;
  /** runtime caches (regenerable, safe to drop) */
  thumbnail?: string;
  proxyPath?: string;
  proxyState?: "none" | "pending" | "ready" | "failed";
  missing?: boolean;
}

export interface MediaFolder {
  id: string;
  name: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  /** linear gain 0..2 */
  volume: number;
}

export type TransitionType = "fade" | "dissolve" | "slide-left" | "slide-right" | "slide-up" | "slide-down";

export interface Transition {
  type: TransitionType;
  duration: number;
}

export interface Transform {
  /** offset from canvas centre, in canvas pixels */
  x: number;
  y: number;
  /** 1 = fit to canvas */
  scale: number;
  /** degrees */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface Crop {
  /** fractions 0..1 of the source frame */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ClipBase {
  id: string;
  trackId: string;
  /** timeline position, seconds */
  start: number;
  /** timeline duration, seconds */
  duration: number;
  name?: string;
  transitionIn?: Transition | null;
  transitionOut?: Transition | null;
}

export interface MediaClip extends ClipBase {
  type: "media";
  mediaId: string;
  /** source in-point, seconds */
  in: number;
  speed: number;
  volume: number;
  muted: boolean;
  opacity: number;
  transform: Transform;
  crop: Crop;
  audioFadeIn: number;
  audioFadeOut: number;
  /** reverse playback (Milestone 4) */
  reverse?: boolean;
}

export type TextAnimation = "none" | "fade" | "slide-up" | "slide-down" | "pop" | "typewriter";

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  align: "start" | "center" | "end";
  lineHeight: number;
  letterSpacing: number;
  outlineColor: string;
  outlineWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundPadding: number;
  backgroundRadius: number;
  /** text box centre, fraction of canvas (0..1) */
  x: number;
  y: number;
  /** max width as fraction of canvas */
  maxWidth: number;
  direction: "auto" | "rtl" | "ltr";
  /** use Arabic-Indic digits (٠١٢٣) */
  arabicDigits: boolean;
}

export interface TextClip extends ClipBase {
  type: "text";
  text: string;
  style: TextStyle;
  opacity: number;
  animIn: TextAnimation;
  animOut: TextAnimation;
  animDuration: number;
}

export type Clip = MediaClip | TextClip;

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  background: string;
  sampleRate: number;
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  id: string;
  name: string;
  createdAt: number;
  settings: ProjectSettings;
  media: MediaAsset[];
  mediaFolders: MediaFolder[];
  tracks: Track[];
  clips: Record<string, Clip>;
  markers: { id: string; time: number; label: string; color: string }[];
}

export const isMediaClip = (c: Clip | undefined | null): c is MediaClip => !!c && c.type === "media";
export const isTextClip = (c: Clip | undefined | null): c is TextClip => !!c && c.type === "text";
