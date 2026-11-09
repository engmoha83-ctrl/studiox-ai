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
  /** solo: when any track is soloed, only soloed audio is heard */
  solo?: boolean;
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

// ------------------------------------------------------------------ Milestone 4

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";
export interface Keyframe {
  /** clip-local time, seconds */
  t: number;
  v: number;
  ease: Easing;
}
export type KfProp = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
export type Keyframes = Partial<Record<KfProp, Keyframe[]>>;

export interface CurvePoint {
  x: number;
  y: number;
}
export interface ColorParams {
  exposure: number; // stops, -3..3
  contrast: number; // -1..1
  highlights: number; // -1..1
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number; // -1 (cool) .. 1 (warm)
  tint: number; // -1 (green) .. 1 (magenta)
  saturation: number; // -1..1
  vibrance: number; // -1..1
  hue: number; // degrees -180..180
  /** colour wheels: per-channel offsets -1..1 */
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  /** curves: monotone points in 0..1 (empty/identity = off) */
  curves: { master: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
  /** imported .cube LUT */
  lutPath?: string | null;
  lutIntensity: number; // 0..1
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  similarity: number; // 0.01..0.6
  blend: number; // 0..0.5
}

export type EffectType = "blur" | "sharpen" | "vignette" | "grain" | "letterbox";
export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  amount: number; // 0..1 (letterbox: bar height fraction)
}

export interface Mask {
  shape: "rectangle" | "ellipse";
  /** centre and size as fractions of the clip frame */
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number; // 0..0.5 of the smaller side
  invert: boolean;
}

export interface AudioFx {
  eqLow: number; // dB -12..12 @100 Hz
  eqMid: number; // @1 kHz
  eqHigh: number; // @8 kHz
  compressor: number; // 0 (off) .. 1
  noiseReduction: number; // 0 (off) .. 1
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
  /** reverse playback (reserved) */
  reverse?: boolean;
  color?: ColorParams | null;
  chromaKey?: ChromaKey | null;
  effects?: Effect[];
  mask?: Mask | null;
  keyframes?: Keyframes;
  audioFx?: AudioFx | null;
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
  /** master bus: output limiter */
  master?: { volume: number; limiter: boolean };
  media: MediaAsset[];
  mediaFolders: MediaFolder[];
  tracks: Track[];
  clips: Record<string, Clip>;
  markers: { id: string; time: number; label: string; color: string }[];
}

export const isMediaClip = (c: Clip | undefined | null): c is MediaClip => !!c && c.type === "media";
export const isTextClip = (c: Clip | undefined | null): c is TextClip => !!c && c.type === "text";
