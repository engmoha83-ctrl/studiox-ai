export type Container = "mp4" | "mov" | "webm";
export type RateControl = "crf" | "vbr" | "cbr";

export interface ExportSettings {
  container: Container;
  videoCodec: string; // FFmpeg encoder name
  width: number;
  height: number;
  fps: number;
  rateControl: RateControl;
  /** 0 (worst) .. 100 (best) – mapped per encoder */
  quality: number;
  bitrateKbps: number;
  speedPreset: "fast" | "medium" | "slow";
  audioCodec: string;
  audioBitrateKbps: number;
  sampleRate: number;
  includeAudio: boolean;
}

export interface AspectPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: "16:9", label: "16:9", width: 1920, height: 1080 },
  { id: "9:16", label: "9:16", width: 1080, height: 1920 },
  { id: "1:1", label: "1:1", width: 1080, height: 1080 },
  { id: "4:5", label: "4:5", width: 1080, height: 1350 },
  { id: "21:9", label: "21:9", width: 2560, height: 1080 },
  { id: "4:3", label: "4:3", width: 1440, height: 1080 },
];

export const RESOLUTIONS = [
  { id: "480p", short: 480 },
  { id: "720p", short: 720 },
  { id: "1080p", short: 1080 },
  { id: "2K", short: 1440 },
  { id: "4K", short: 2160 },
  { id: "8K", short: 4320 },
];

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 60, 120];

/** Output size for a resolution name keeping the project aspect ratio (short side = res). */
export function sizeFor(projectW: number, projectH: number, short: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (projectW >= projectH) return { width: even((projectW / projectH) * short), height: even(short) };
  return { width: even(short), height: even((projectH / projectW) * short) };
}

export interface SocialPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  maxDuration?: number;
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: "youtube-1080", name: "YouTube 1080p", width: 1920, height: 1080, fps: 30, bitrateKbps: 12000 },
  { id: "youtube-4k", name: "YouTube 4K", width: 3840, height: 2160, fps: 30, bitrateKbps: 45000 },
  { id: "youtube-shorts", name: "YouTube Shorts", width: 1080, height: 1920, fps: 30, bitrateKbps: 10000, maxDuration: 180 },
  { id: "tiktok", name: "TikTok", width: 1080, height: 1920, fps: 30, bitrateKbps: 10000, maxDuration: 600 },
  { id: "reels", name: "Instagram Reels", width: 1080, height: 1920, fps: 30, bitrateKbps: 8000, maxDuration: 180 },
  { id: "ig-story", name: "Instagram Stories", width: 1080, height: 1920, fps: 30, bitrateKbps: 8000, maxDuration: 60 },
  { id: "ig-feed", name: "Instagram Feed 4:5", width: 1080, height: 1350, fps: 30, bitrateKbps: 8000 },
  { id: "facebook", name: "Facebook", width: 1920, height: 1080, fps: 30, bitrateKbps: 10000 },
  { id: "x", name: "X (Twitter)", width: 1920, height: 1080, fps: 30, bitrateKbps: 8000, maxDuration: 140 },
  { id: "linkedin", name: "LinkedIn", width: 1920, height: 1080, fps: 30, bitrateKbps: 8000, maxDuration: 600 },
];

/** Which encoders make sense in each container. */
export const CONTAINER_VIDEO: Record<Container, string[]> = {
  mp4: ["libx264", "h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox", "h264_mf", "libopenh264", "libx265", "hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox", "hevc_mf", "libsvtav1", "libaom-av1", "av1_nvenc", "av1_qsv", "av1_amf"],
  mov: ["libx264", "h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox", "h264_mf", "libx265", "hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_videotoolbox", "prores_ks", "prores_videotoolbox"],
  webm: ["libvpx-vp9", "libsvtav1", "libaom-av1"],
};
export const CONTAINER_AUDIO: Record<Container, string[]> = {
  mp4: ["aac", "libfdk_aac", "libopus", "libmp3lame"],
  mov: ["aac", "libfdk_aac", "pcm_s16le", "pcm_s24le", "alac"],
  webm: ["libopus"],
};

export function codecFamily(enc: string): "h264" | "hevc" | "av1" | "vp9" | "prores" | "other" {
  if (enc.includes("264")) return "h264";
  if (enc.includes("hevc") || enc.includes("265")) return "hevc";
  if (enc.includes("av1")) return "av1";
  if (enc.includes("vp9")) return "vp9";
  if (enc.includes("prores")) return "prores";
  return "other";
}

export const isHardwareEncoder = (e: string) => /_(nvenc|qsv|amf|videotoolbox|mf)$/.test(e);

export function defaultExportSettings(projectW: number, projectH: number, fps: number): ExportSettings {
  return {
    container: "mp4",
    videoCodec: "libx264",
    width: projectW,
    height: projectH,
    fps,
    rateControl: "crf",
    quality: 70,
    bitrateKbps: 12000,
    speedPreset: "medium",
    audioCodec: "aac",
    audioBitrateKbps: 192,
    sampleRate: 48000,
    includeAudio: true,
  };
}
