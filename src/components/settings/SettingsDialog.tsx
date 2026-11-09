import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CircleCheck, Cpu, FolderOpen, HardDrive, LoaderCircle, MonitorCog, TriangleAlert } from "lucide-react";
import { api, errorText } from "../../backend/api";
import { applyLanguage } from "../../i18n";
import { useApp } from "../../store/appStore";
import { useUi } from "../../store/uiStore";
import { Button, Modal, Row, Section, Select, Toggle } from "../common/ui";
import AiModels from "./AiModels";

export default function SettingsDialog() {
  const { t } = useTranslation();
  const info = useApp((s) => s.info);
  const system = useApp((s) => s.system);
  const caps = useApp((s) => s.caps);
  const language = useApp((s) => s.language);
  const autoProxy = useApp((s) => s.autoProxy);
  const quality = useUi((s) => s.previewQuality);
  const [checking, setChecking] = useState(false);
  const close = () => useApp.getState().openDialog("settings", false);
  const set = useApp.getState().set;

  useEffect(() => {
    if (!caps && info?.ffmpeg.found)
      void api
        .encoderCaps()
        .then((c) => set({ caps: c }))
        .catch(() => undefined);
  }, [caps, info, set]);

  const pickFfmpeg = async () => {
    const dir = await openDialog({ directory: true });
    if (typeof dir !== "string") return;
    setChecking(true);
    try {
      const ff = await api.setFfmpegDir(dir);
      set({ info: { ...info!, ffmpeg: ff }, caps: undefined });
      useApp.getState().toast(t("FFmpeg found: {{v}}", { v: ff.version ?? "" }), "success");
    } catch (e) {
      useApp.getState().toast(errorText(e), "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal title={t("Settings")} onClose={close} width={640}>
      <Section title={t("General")}>
        <Row label={t("Language")}>
          <Select
            value={language}
            onChange={async (l) => {
              applyLanguage(l);
              set({ language: l });
              await api.setSetting("language", l);
            }}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
            ]}
          />
        </Row>
        <Row label={t("Preview quality")}>
          <Select
            value={quality}
            onChange={(q) => {
              useUi.getState().set({ previewQuality: q });
              void api.setSetting("previewQuality", String(q));
            }}
            options={[
              { value: 1, label: t("Full") },
              { value: 0.5, label: t("Half") },
              { value: 0.25, label: t("Quarter") },
            ]}
          />
        </Row>
        <Row label={t("Proxies")}>
          <Toggle
            checked={autoProxy}
            onChange={(v) => {
              set({ autoProxy: v });
              void api.setSetting("autoProxy", v ? "1" : "0");
            }}
            label={t("Create proxies automatically for media above 1440p")}
          />
        </Row>
        <p className="text-[11.5px] text-dim">{t("Formats the preview cannot decode (ProRes, DNxHD, AVI, MKV with unsupported codecs …) always get a proxy. Exports always use the original files.")}</p>
      </Section>

      <Section title={t("FFmpeg")}>
        {info?.ffmpeg.found ? (
          <div className="flex items-start gap-2 text-[12px]">
            <CircleCheck size={15} className="mt-0.5 text-emerald-400" />
            <div className="min-w-0">
              <div className="truncate" dir="ltr">
                {info.ffmpeg.version}
              </div>
              <div className="truncate text-dim" dir="ltr">
                {info.ffmpeg.ffmpeg} · {t(info.ffmpeg.source === "bundled" ? "bundled" : info.ffmpeg.source === "settings" ? "custom folder" : "system")}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-[12px] text-amber-200">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            {t("FFmpeg is required for import, preview proxies and export. Install it (e.g. “winget install Gyan.FFmpeg”) or choose the folder that contains ffmpeg and ffprobe.")}
          </div>
        )}
        <Button onClick={pickFfmpeg} disabled={checking}>
          {checking ? <LoaderCircle size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          {t("Choose FFmpeg folder…")}
        </Button>
        {caps && (
          <div className="text-[12px]">
            <div className="text-muted">{t("Hardware encoders (verified)")}:</div>
            <div className="mt-1 flex flex-wrap gap-1.5" dir="ltr">
              {caps.hardware.length ? caps.hardware.map((h) => <span key={h} className="rounded bg-teal-500/15 px-1.5 py-0.5 text-teal-200">{h}</span>) : <span className="text-dim">{t("none")}</span>}
            </div>
          </div>
        )}
      </Section>

      <AiModels />

      {system && (
        <Section title={t("System")}>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="flex items-center gap-2">
              <MonitorCog size={14} className="text-dim" />
              <span dir="ltr">
                {system.os} {system.osVersion} ({system.arch})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-dim" />
              <span className="truncate" title={system.cpu}>
                {system.cpu} · {system.cpuCores}C/{system.cpuThreads}T
              </span>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-dim" />
              <span dir="ltr">
                {Math.round(system.ramMb / 1024)} GB RAM · {Math.round(system.diskFreeMb / 1024)} GB {t("free")}
              </span>
            </div>
            <div className="truncate" dir="ltr" title={system.gpus.map((g) => g.name).join(", ")}>
              GPU: {system.gpus.map((g) => g.name + (g.vramMb ? ` (${Math.round(g.vramMb / 1024)} GB+)` : "")).join(", ") || "—"}
            </div>
          </div>
          <Row label={t("Profile")}>
            <b className="text-violet-200">{t(system.profile === "low" ? "Low-end" : system.profile === "high" ? "High performance" : "Balanced")}</b>
          </Row>
          <p className="text-[11.5px] text-dim">
            {t("The profile was used to choose default preview quality and proxy behaviour. GPU-heavy AI models are never assumed to work; they are tested before use.")}
          </p>
        </Section>
      )}
      {info && (
        <p className="px-3 pt-3 text-[11px] text-dim" dir="ltr">
          Data: {info.dataDir}
        </p>
      )}
    </Modal>
  );
}
