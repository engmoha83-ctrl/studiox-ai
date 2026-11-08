// Typed bridge to the Rust core. This is the ONLY module that calls invoke().
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface FfmpegInfo {
  found: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  version?: string;
  major: number;
  source: string;
}
export interface AppInfo {
  version: string;
  dataDir: string;
  cacheDir: string;
  platform: string;
  mediaBase: string;
  ffmpeg: FfmpegInfo;
}
export interface ProbeResult {
  kind: "video" | "audio" | "image";
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec?: string | null;
  audioCodec?: string | null;
  pixFmt?: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  sampleRate: number;
  channels: number;
  size: number;
  mtime: number;
  formatName: string;
  rotation: number;
  bitRate: number;
}
export interface Filmstrip {
  path: string;
  count: number;
  tileWidth: number;
  tileHeight: number;
  interval: number;
}
export interface Waveform {
  peaksPerSecond: number;
  peaks: number[];
}
export interface EncoderCaps {
  video: string[];
  audio: string[];
  hardware: string[];
}
export interface SystemInfo {
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cpuCores: number;
  cpuThreads: number;
  ramMb: number;
  gpus: { name: string; vramMb?: number | null }[];
  diskFreeMb: number;
  diskTotalMb: number;
  profile: "low" | "balanced" | "high";
}
export interface ProjectMeta {
  id: string;
  name: string;
  folder: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string | null;
  duration: number;
  width: number;
  height: number;
}
export interface BackupMeta {
  id: number;
  projectId: string;
  createdAt: number;
  label: string;
  kind: "auto" | "named";
  size: number;
}
export interface JobProgress {
  id: string;
  kind: string;
  progress: number;
  outTime: number;
  fps: number;
  speed: string;
  elapsed: number;
  eta?: number | null;
}
export interface JobEnd {
  id: string;
  kind: string;
  output?: string | null;
  message?: string | null;
  elapsed: number;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let mediaBase = "";
/** Set once at start-up: loopback media server (HTTP range requests) provided by the Rust core. */
export const setMediaBase = (b: string) => void (mediaBase = b);
/** URL the WebView can load a local file from (video/audio/images/thumbnails). */
export const fileUrl = (path: string) => (mediaBase ? mediaBase + encodeURIComponent(path) : convertFileSrc(path));

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  setFfmpegDir: (dir: string) => invoke<FfmpegInfo>("set_ffmpeg_dir", { dir }),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  encoderCaps: () => invoke<EncoderCaps>("encoder_caps"),

  probe: (path: string) => invoke<ProbeResult>("probe_media", { path }),
  thumbnail: (path: string, kind: string, time: number) => invoke<string>("make_thumbnail", { path, kind, time }),
  filmstrip: (path: string, duration: number, width: number, height: number) => invoke<Filmstrip>("make_filmstrip", { path, duration, width, height }),
  waveform: (path: string, duration: number) => invoke<Waveform>("make_waveform", { path, duration }),
  startProxy: (jobId: string, path: string, duration: number, hasAudio: boolean) => invoke<string>("start_proxy", { jobId, path, duration, hasAudio }),

  writeJobFile: (jobId: string, name: string, base64Data: string) => invoke<string>("write_job_file", { jobId, name, base64Data }),
  startExport: (req: { jobId: string; inputArgs: string[]; filterGraph: string; outputArgs: string[]; outputPath: string; duration: number }) =>
    invoke<void>("start_export", { req }),
  cancelJob: (jobId: string) => invoke<boolean>("cancel_job", { jobId }),

  detectSilence: (path: string, noiseDb: number, minDuration: number) => invoke<{ start: number; end: number }[]>("detect_silence", { path, noiseDb, minDuration }),
  detectScenes: (path: string, threshold: number) => invoke<number[]>("detect_scenes", { path, threshold }),

  filesExist: (paths: string[]) => invoke<boolean[]>("files_exist", { paths }),
  findFilesInDir: (dir: string, names: string[]) => invoke<Record<string, string>>("find_files_in_dir", { dir, names }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, content: string) => invoke<void>("write_text_file", { path, content }),

  listProjects: () => invoke<ProjectMeta[]>("db_list_projects"),
  saveProject: (data: string, thumbnail?: string | null) => invoke<number>("db_save_project", { data, thumbnail: thumbnail ?? null }),
  loadProject: (id: string) => invoke<string>("db_load_project", { id }),
  renameProject: (id: string, name: string) => invoke<void>("db_rename_project", { id, name }),
  duplicateProject: (id: string, newId: string, newName: string) => invoke<void>("db_duplicate_project", { id, newId, newName }),
  setArchived: (id: string, archived: boolean) => invoke<void>("db_set_archived", { id, archived }),
  setFolder: (id: string, folder: string) => invoke<void>("db_set_folder", { id, folder }),
  deleteProject: (id: string) => invoke<void>("db_delete_project", { id }),
  addBackup: (projectId: string, label: string, kind: "auto" | "named", data: string) => invoke<number>("db_add_backup", { projectId, label, kind, data }),
  listBackups: (projectId: string) => invoke<BackupMeta[]>("db_list_backups", { projectId }),
  getBackup: (id: number) => invoke<string>("db_get_backup", { id }),
  deleteBackup: (id: number) => invoke<void>("db_delete_backup", { id }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
};

export function onJobProgress(cb: (p: JobProgress) => void): Promise<UnlistenFn> {
  return listen<JobProgress>("job-progress", (e) => cb(e.payload));
}
export function onJobDone(cb: (p: JobEnd) => void): Promise<UnlistenFn> {
  return listen<JobEnd>("job-done", (e) => cb(e.payload));
}
export function onJobError(cb: (p: JobEnd) => void): Promise<UnlistenFn> {
  return listen<JobEnd>("job-error", (e) => cb(e.payload));
}
export function onJobCancelled(cb: (p: JobEnd) => void): Promise<UnlistenFn> {
  return listen<JobEnd>("job-cancelled", (e) => cb(e.payload));
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
