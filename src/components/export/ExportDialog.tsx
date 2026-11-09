import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { documentDir, homeDir, videoDir } from "@tauri-apps/api/path";
import { Cpu, Upload, FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";
import { api, errorText } from "../../backend/api";
import { CONTAINER_AUDIO, CONTAINER_VIDEO, FRAME_RATES, RESOLUTIONS, SOCIAL_PRESETS, codecFamily, defaultExportSettings, isHardwareEncoder, sizeFor, type Container, type ExportSettings } from "../../engine/presets";
import { projectDuration } from "../../engine/timelineOps";
import { formatBytes, shortTime } from "../../lib/time";
import { enqueueExport } from "../../services/exporter";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { Button, Modal, NumberField, Row, Select, Slider, Toggle, cx } from "../common/ui";

const ENCODER_LABEL: Record<string, string> = {
  libx264: "H.264 (x264)",
  libx265: "H.265 / HEVC (x265)",
  libsvtav1: "AV1 (SVT-AV1)",
  "libaom-av1": "AV1 (libaom)",
  "libvpx-vp9": "VP9",
  prores_ks: "Apple ProRes 422 HQ",
  prores_videotoolbox: "Apple ProRes (VideoToolbox)",
  libopenh264: "H.264 (OpenH264)",
  h264_nvenc: "H.264 · NVIDIA NVENC",
  hevc_nvenc: "H.265 · NVIDIA NVENC",
  av1_nvenc: "AV1 · NVIDIA NVENC",
  h264_qsv: "H.264 · Intel Quick Sync",
  hevc_qsv: "H.265 · Intel Quick Sync",
  av1_qsv: "AV1 · Intel Quick Sync",
  h264_amf: "H.264 · AMD AMF",
  hevc_amf: "H.265 · AMD AMF",
  av1_amf: "AV1 · AMD AMF",
  h264_videotoolbox: "H.264 · Apple VideoToolbox",
  hevc_videotoolbox: "H.265 · Apple VideoToolbox",
  h264_mf: "H.264 · Windows Media Foundation",
  hevc_mf: "H.265 · Windows Media Foundation",
};
const AUDIO_LABEL: Record<string, string> = { aac: "AAC", libfdk_aac: "AAC (FDK)", libopus: "Opus", libmp3lame: "MP3", pcm_s16le: "PCM 16-bit", pcm_s24le: "PCM 24-bit", alac: "Apple Lossless" };

export default function ExportDialog() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const caps = useApp((s) => s.caps);
  const close = () => useApp.getState().openDialog("export", false);
  const [s, setS] = useState<ExportSettings>(() => defaultExportSettings(project.settings.width, project.settings.height, project.settings.fps));
  const [name, setName] = useState(project.name.replace(/[\\/:*?"<>|]/g, "_"));
  const [folder, setFolder] = useState("");
  const [batch, setBatch] = useState<string[]>([]);
  const [loadingCaps, setLoadingCaps] = useState(!caps);
  const duration = projectDuration(project);
  const up = (p: Partial<ExportSettings>) => setS((x) => ({ ...x, ...p }));

  useEffect(() => {
    void (async () => {
      const candidates = [() => api.getSetting("lastExportFolder"), videoDir, documentDir, homeDir];
      for (const c of candidates) {
        try {
          const f = await c();
          if (f) return setFolder(f);
        } catch {
          /* try next */
        }
      }
    })();
    if (!caps)
      api
        .encoderCaps()
        .then((c) => useApp.getState().set({ caps: c }))
        .catch((e) => useApp.getState().toast(errorText(e), "error"))
        .finally(() => setLoadingCaps(false));
  }, [caps]);

  const videoEncoders = useMemo(() => (caps ? CONTAINER_VIDEO[s.container].filter((e) => caps.video.includes(e)) : []), [caps, s.container]);
  const audioEncoders = useMemo(() => (caps ? CONTAINER_AUDIO[s.container].filter((e) => caps.audio.includes(e)) : []), [caps, s.container]);
  useEffect(() => {
    if (videoEncoders.length && !videoEncoders.includes(s.videoCodec)) up({ videoCodec: videoEncoders[0] });
    if (audioEncoders.length && !audioEncoders.includes(s.audioCodec)) up({ audioCodec: audioEncoders[0] });
  }, [videoEncoders, audioEncoders, s.videoCodec, s.audioCodec]);

  const ext = s.container;
  const sep = folder.includes("\\") ? "\\" : "/";
  const outPath = (suffix = "") => `${folder}${folder.endsWith(sep) ? "" : sep}${name}${suffix}.${ext}`;
  const prores = codecFamily(s.videoCodec) === "prores";
  const estKbps = s.rateControl === "crf" || prores ? null : s.bitrateKbps + (s.includeAudio ? s.audioBitrateKbps : 0);
  const resId = RESOLUTIONS.find((r) => {
    const z = sizeFor(project.settings.width, project.settings.height, r.short);
    return z.width === s.width && z.height === s.height;
  })?.id;

  const start = () => {
    if (!folder || !name.trim()) return;
    void api.setSetting("lastExportFolder", folder);
    if (!batch.length) enqueueExport(s, outPath(), name);
    for (const id of batch) {
      const p = SOCIAL_PRESETS.find((x) => x.id === id)!;
      const ps: ExportSettings = { ...s, width: p.width, height: p.height, fps: p.fps, rateControl: "vbr", bitrateKbps: p.bitrateKbps };
      enqueueExport(ps, outPath(`_${p.id}`), `${name} · ${p.name}`);
    }
    useApp.getState().openDialog("queue", true);
    close();
  };

  return (
    <Modal
      title={t("Export video")}
      onClose={close}
      width={880}
      footer={
        <>
          <span className="me-auto text-[12px] text-dim">
            {t("Duration")}: <span dir="ltr">{shortTime(duration)}</span>
            {estKbps && <> · {t("Estimated size")}: <span dir="ltr">{formatBytes((estKbps * 1000 * duration) / 8)}</span></>}
          </span>
          <Button variant="ghost" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" disabled={!folder || !name.trim() || duration <= 0 || !videoEncoders.length} onClick={start}>
            <Upload size={15} />
            {batch.length ? t("Export {{n}} versions", { n: batch.length }) : t("Export")}
          </Button>
        </>
      }
    >
      {duration <= 0 && <div className="mb-3 rounded-md bg-amber-500/10 p-2.5 text-[12px] text-amber-200">{t("The timeline is empty — add clips before exporting.")}</div>}
      <div className="grid grid-cols-[260px_1fr] gap-5">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Social media presets")}</div>
          <div className="space-y-1">
            {SOCIAL_PRESETS.map((p) => {
              const on = batch.includes(p.id);
              const tooLong = p.maxDuration && duration > p.maxDuration;
              return (
                <label key={p.id} className={cx("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5", on ? "border-accent bg-accent/10" : "border-line hover:bg-panel-3")}>
                  <input type="checkbox" checked={on} onChange={() => setBatch(on ? batch.filter((x) => x !== p.id) : [...batch, p.id])} className="accent-violet-500" />
                  <span className="flex-1">
                    <span className="block text-[12.5px]">{p.name}</span>
                    <span className="block text-[11px] text-dim" dir="ltr">
                      {p.width}×{p.height} · {p.fps}fps · {p.bitrateKbps / 1000} Mb/s
                    </span>
                  </span>
                  {tooLong && (
                    <span title={t("Longer than the platform limit ({{s}})", { s: shortTime(p.maxDuration!) })}>
                      <TriangleAlert size={14} className="text-amber-400" />
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-dim">{t("Tick one or more presets for a batch export, or leave all unticked to use the custom settings.")}</p>
        </div>
        <div className="space-y-3">
          <Row label={t("File name")}>
            <input dir="auto" className="h-8 w-full rounded-md border border-line-2 bg-panel-2 px-2.5 outline-none focus:border-accent" value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, "_"))} />
            <span className="text-dim">.{ext}</span>
          </Row>
          <Row label={t("Folder")}>
            <div className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-line-2 bg-panel-2 px-2.5 text-[12px] text-muted" dir="ltr" title={folder}>
              {folder || "—"}
            </div>
            <Button
              onClick={async () => {
                const f = await openDialog({ directory: true, defaultPath: folder || undefined });
                if (typeof f === "string") setFolder(f);
              }}
            >
              <FolderOpen size={14} />
            </Button>
          </Row>
          <div className={cx("space-y-3 rounded-lg border border-line p-3", batch.length > 0 && "opacity-60")}>
            {batch.length > 0 && <p className="text-[11.5px] text-dim">{t("Resolution, frame rate and bitrate come from the selected presets.")}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Row label={t("Format")}>
                <Select value={s.container} onChange={(c: Container) => up({ container: c })} options={[{ value: "mp4", label: "MP4" }, { value: "mov", label: "MOV" }, { value: "webm", label: "WebM" }]} />
              </Row>
              <Row label={t("Video codec")}>
                {loadingCaps ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-muted">
                    <LoaderCircle size={13} className="animate-spin" />
                    {t("Detecting encoders…")}
                  </span>
                ) : (
                  <Select value={s.videoCodec} onChange={(v) => up({ videoCodec: v })} options={videoEncoders.map((e) => ({ value: e, label: ENCODER_LABEL[e] ?? e }))} />
                )}
              </Row>
              <Row label={t("Resolution")}>
                <Select
                  value={resId ?? "custom"}
                  onChange={(id) => {
                    const r = RESOLUTIONS.find((x) => x.id === id);
                    if (r) up(sizeFor(project.settings.width, project.settings.height, r.short));
                  }}
                  options={[...RESOLUTIONS.map((r) => ({ value: r.id, label: r.id })), { value: "custom", label: t("Custom"), disabled: true }]}
                />
              </Row>
              <Row label={t("Size")}>
                <NumberField value={s.width} onChange={(v) => up({ width: Math.round(v / 2) * 2 })} min={16} max={8192} precision={0} />
                <span className="text-dim">×</span>
                <NumberField value={s.height} onChange={(v) => up({ height: Math.round(v / 2) * 2 })} min={16} max={8192} precision={0} />
              </Row>
              <Row label={t("Frame rate")}>
                <Select value={s.fps} onChange={(v) => up({ fps: v })} options={FRAME_RATES.map((f) => ({ value: f, label: `${f} fps` }))} />
              </Row>
              <Row label={t("Encoding speed")}>
                <Select value={s.speedPreset} onChange={(v) => up({ speedPreset: v })} options={[{ value: "fast", label: t("Fast") }, { value: "medium", label: t("Balanced") }, { value: "slow", label: t("Best quality") }]} />
              </Row>
            </div>
            {!prores && (
              <>
                <Row label={t("Rate control")}>
                  <Select
                    value={s.rateControl}
                    onChange={(v) => up({ rateControl: v })}
                    options={[
                      { value: "crf", label: t("Constant quality (recommended)") },
                      { value: "vbr", label: t("Variable bitrate (VBR)") },
                      { value: "cbr", label: t("Constant bitrate (CBR)") },
                    ]}
                  />
                </Row>
                {s.rateControl === "crf" ? (
                  <Row label={t("Quality")}>
                    <Slider value={s.quality} min={0} max={100} step={1} precision={0} onChange={(v) => up({ quality: v })} />
                  </Row>
                ) : (
                  <Row label={t("Bitrate")}>
                    <Slider value={s.bitrateKbps} min={500} max={150000} step={100} precision={0} suffix="kb/s" onChange={(v) => up({ bitrateKbps: v })} />
                  </Row>
                )}
              </>
            )}
            {isHardwareEncoder(s.videoCodec) && (
              <p className="flex items-center gap-1.5 text-[11.5px] text-teal-300">
                <Cpu size={13} />
                {t("Hardware encoder verified on this computer.")}
              </p>
            )}
          </div>
          <div className="space-y-3 rounded-lg border border-line p-3">
            <Row label={t("Audio")}>
              <Toggle checked={s.includeAudio} onChange={(v) => up({ includeAudio: v })} label={t("Include audio")} />
            </Row>
            {s.includeAudio && (
              <div className="grid grid-cols-3 gap-3">
                <Select value={s.audioCodec} onChange={(v) => up({ audioCodec: v })} options={audioEncoders.map((e) => ({ value: e, label: AUDIO_LABEL[e] ?? e }))} />
                <Select value={s.audioBitrateKbps} onChange={(v) => up({ audioBitrateKbps: v })} options={[96, 128, 160, 192, 256, 320].map((b) => ({ value: b, label: `${b} kb/s` }))} />
                <Select value={s.sampleRate} onChange={(v) => up({ sampleRate: v })} options={[44100, 48000].map((r) => ({ value: r, label: `${r / 1000} kHz` }))} />
              </div>
            )}
          </div>
          {caps && caps.hardware.length === 0 && <p className="text-[11px] text-dim">{t("No working hardware encoder was detected; software encoders are used.")}</p>}
        </div>
      </div>
    </Modal>
  );
}
