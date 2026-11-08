// Media import, metadata, thumbnails, filmstrips, waveforms, proxies, relink.
import { api, errorText, type ProbeResult } from "../backend/api";
import { app } from "../store/appStore";
import { commit, getProject, useProject } from "../store/projectStore";
import { uid } from "../lib/id";
import type { MediaAsset } from "../types/project";
import i18n from "../i18n";

export const MEDIA_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "flv", "mts", "m2ts", "ts", "mxf", "3gp", "mpg", "mpeg", "gif",
  "mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "wma", "aiff", "aif",
  "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff",
];

const PLAYABLE_VIDEO = new Set(["h264", "vp8", "vp9", "av1"]);
const PLAYABLE_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le", "pcm_f32le", "pcm_u8", "alac"]);
const PLAYABLE_CONTAINERS = ["mov", "mp4", "m4a", "webm", "matroska", "mp3", "wav", "ogg", "flac", "aac"];

type ProbeLike = Pick<MediaAsset, "kind" | "videoCodec" | "audioCodec" | "formatName" | "width" | "height">;

/** Can the WebView decode this file directly? */
export function decodable(m: ProbeLike, platform: string): boolean {
  if (m.kind === "image") return true;
  const container = (m.formatName ?? "").toLowerCase();
  const containerOk = PLAYABLE_CONTAINERS.some((c) => container.includes(c));
  if (m.kind === "audio") return containerOk && (!m.audioCodec || PLAYABLE_AUDIO.has(m.audioCodec));
  const v = (m.videoCodec ?? "").toLowerCase();
  const videoOk = PLAYABLE_VIDEO.has(v) || (v === "hevc" && platform === "macos");
  const audioOk = !m.audioCodec || PLAYABLE_AUDIO.has(m.audioCodec);
  return containerOk && videoOk && audioOk;
}

/** Proxy needed: not decodable, or very large (>1440p) when auto-proxy is on. */
export function needsProxy(m: ProbeLike, platform: string): boolean {
  if (m.kind === "image") return false;
  const huge = m.kind === "video" && Math.max(m.width, m.height) > 2560 && app().autoProxy;
  return !decodable(m, platform) || huge;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function assetFromProbe(path: string, r: ProbeResult, folderId: string | null): MediaAsset {
  return {
    id: uid("med"),
    path,
    name: fileName(path),
    kind: r.kind,
    duration: r.duration,
    width: r.width,
    height: r.height,
    fps: r.fps,
    videoCodec: r.videoCodec,
    audioCodec: r.audioCodec,
    formatName: r.formatName,
    hasVideo: r.hasVideo,
    hasAudio: r.hasAudio,
    size: r.size,
    mtime: r.mtime,
    addedAt: Date.now(),
    folderId,
    favorite: false,
    proxyState: "none",
  };
}

/** Import files into the project media library. Returns the created assets (duplicates are reused). */
export async function importFiles(paths: string[], folderId: string | null = null): Promise<MediaAsset[]> {
  const p = getProject();
  if (!p) return [];
  const created: MediaAsset[] = [];
  const reused: MediaAsset[] = [];
  const failures: string[] = [];
  const valid = paths.filter((x) => MEDIA_EXTENSIONS.includes(x.split(".").pop()?.toLowerCase() ?? ""));
  if (valid.length < paths.length) failures.push(...paths.filter((x) => !valid.includes(x)).map((x) => `${fileName(x)}: ${i18n.t("Unsupported file type")}`));
  const results = await Promise.all(
    valid.map(async (path) => {
      try {
        return { path, r: await api.probe(path) };
      } catch (e) {
        failures.push(`${fileName(path)}: ${errorText(e)}`);
        return null;
      }
    }),
  );
  for (const res of results) {
    if (!res) continue;
    const dup = getProject()!.media.find((m) => m.path === res.path || (m.size === res.r.size && m.name === fileName(res.path) && Math.abs(m.duration - res.r.duration) < 0.01));
    if (dup) {
      reused.push(dup);
      continue;
    }
    created.push(assetFromProbe(res.path, res.r, folderId));
  }
  if (created.length) commit(i18n.t("Import media"), (d) => void d.media.push(...created));
  if (reused.length && !created.length) app().toast(i18n.t("Already in the library: {{names}}", { names: reused.map((m) => m.name).join(", ") }));
  if (failures.length) app().toast(failures.join("\n"), "error");
  for (const m of created) void prepareAsset(m.id);
  return [...created, ...reused];
}

function patchMedia(id: string, f: (m: MediaAsset) => void) {
  useProject.getState().patch((d) => {
    const m = d.media.find((x) => x.id === id);
    if (m) f(m);
  });
}

/** Background work for an asset: thumbnail and proxy. */
export async function prepareAsset(id: string) {
  const m = getProject()?.media.find((x) => x.id === id);
  if (!m) return;
  try {
    const t = await api.thumbnail(m.path, m.kind, m.kind === "video" ? Math.min(1, m.duration / 3) : 0);
    patchMedia(id, (x) => (x.thumbnail = t));
  } catch {
    /* thumbnail is optional */
  }
  const platform = app().info?.platform ?? "windows";
  if (needsProxy(m, platform) && (!m.proxyPath || m.proxyState !== "ready")) void createProxy(id);
}

const proxyJobs = new Map<string, string>(); // jobId -> mediaId

export async function createProxy(id: string) {
  const m = getProject()?.media.find((x) => x.id === id);
  if (!m || m.kind === "image") return;
  const jobId = uid("proxy");
  proxyJobs.set(jobId, id);
  patchMedia(id, (x) => (x.proxyState = "pending"));
  try {
    const existing = await api.startProxy(jobId, m.path, m.duration, m.hasAudio);
    if (existing) {
      proxyJobs.delete(jobId);
      patchMedia(id, (x) => {
        x.proxyPath = existing;
        x.proxyState = "ready";
      });
    }
  } catch (e) {
    proxyJobs.delete(jobId);
    patchMedia(id, (x) => (x.proxyState = "failed"));
    app().toast(`${m.name}: ${errorText(e)}`, "error");
  }
}

export function handleProxyEnd(jobId: string, output: string | null | undefined, error?: string | null) {
  const id = proxyJobs.get(jobId);
  if (!id) return false;
  proxyJobs.delete(jobId);
  patchMedia(id, (x) => {
    x.proxyPath = output ?? undefined;
    x.proxyState = output ? "ready" : "failed";
  });
  if (error) app().toast(i18n.t("Proxy generation failed") + ": " + error, "error");
  return true;
}

export const proxyProgress: Record<string, number> = {};
export function handleProxyProgress(jobId: string, progress: number) {
  const id = proxyJobs.get(jobId);
  if (id) proxyProgress[id] = progress;
}

/** Timeline helpers – cached per media id */
export async function ensureFilmstrip(m: MediaAsset) {
  const st = app();
  if (st.filmstrips[m.id] || m.kind !== "video") return;
  st.set({ filmstrips: { ...st.filmstrips, [m.id]: "loading" } });
  try {
    const f = await api.filmstrip(m.path, m.duration, m.width, m.height);
    app().set({ filmstrips: { ...app().filmstrips, [m.id]: f } });
  } catch {
    app().set({ filmstrips: { ...app().filmstrips, [m.id]: "error" } });
  }
}

export async function ensureWaveform(m: MediaAsset) {
  const st = app();
  if (st.waveforms[m.id] || !m.hasAudio) return;
  st.set({ waveforms: { ...st.waveforms, [m.id]: "loading" } });
  try {
    const w = await api.waveform(m.path, m.duration);
    app().set({ waveforms: { ...app().waveforms, [m.id]: w } });
  } catch {
    app().set({ waveforms: { ...app().waveforms, [m.id]: "error" } });
  }
}

/** Check that all media files still exist; flag the missing ones. Returns missing count. */
export async function checkMissing(): Promise<number> {
  const p = getProject();
  if (!p || !p.media.length) return 0;
  const exists = await api.filesExist(p.media.map((m) => m.path));
  const proxyExists = await api.filesExist(p.media.map((m) => m.proxyPath ?? ""));
  useProject.getState().patch((d) => {
    d.media.forEach((m, i) => {
      m.missing = !exists[i];
      if (m.proxyPath && !proxyExists[i]) {
        m.proxyPath = undefined;
        m.proxyState = "none";
      }
    });
  });
  return exists.filter((x) => !x).length;
}

/** Point a media item at a new file (keeps all clips). */
export async function relinkMedia(id: string, newPath: string): Promise<boolean> {
  try {
    const r = await api.probe(newPath);
    const m = getProject()?.media.find((x) => x.id === id);
    if (!m) return false;
    if (r.kind !== m.kind) {
      app().toast(i18n.t("The selected file is a different media type."), "error");
      return false;
    }
    commit(i18n.t("Relink media"), (d) => {
      const x = d.media.find((y) => y.id === id)!;
      x.path = newPath;
      x.name = fileName(newPath);
      x.missing = false;
      x.size = r.size;
      x.mtime = r.mtime;
      x.width = r.width;
      x.height = r.height;
      x.videoCodec = r.videoCodec;
      x.audioCodec = r.audioCodec;
      x.formatName = r.formatName;
      if (r.duration > 0) x.duration = r.duration;
      x.proxyPath = undefined;
      x.proxyState = "none";
      x.thumbnail = undefined;
    });
    const st = app();
    const { [id]: _f, ...fs } = st.filmstrips;
    const { [id]: _w, ...ws } = st.waveforms;
    st.set({ filmstrips: fs, waveforms: ws });
    void prepareAsset(id);
    return true;
  } catch (e) {
    app().toast(errorText(e), "error");
    return false;
  }
}

/** Search a folder for every missing file by name. */
export async function relinkFromFolder(dir: string): Promise<number> {
  const p = getProject();
  if (!p) return 0;
  const missing = p.media.filter((m) => m.missing);
  const found = await api.findFilesInDir(dir, missing.map((m) => m.name));
  let n = 0;
  for (const m of missing) {
    const path = found[m.name];
    if (path && (await relinkMedia(m.id, path))) n++;
  }
  return n;
}

/** Which file the preview should decode. */
export function previewPath(m: MediaAsset): string | null {
  if (m.proxyState === "ready" && m.proxyPath) return m.proxyPath;
  return decodable(m, app().info?.platform ?? "windows") ? m.path : null; // otherwise wait for the proxy
}
