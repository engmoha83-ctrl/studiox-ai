import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FileDown, FileUp } from "lucide-react";
import { api, errorText } from "../../backend/api";
import { cuesFromClips, parseSubtitles, toSrt, toVtt } from "../../engine/subtitles";
import { addSubtitleTrack } from "../../services/ai";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { isTextClip } from "../../types/project";
import { Button, Select } from "../common/ui";
import { Plus } from "lucide-react";
import { addText } from "../../editor/actions";
import { beginDrag } from "../../editor/dragdrop";
import type { TextStyle } from "../../types/project";

export interface TextPreset {
  id: string;
  name: string;
  text: string;
  style: Partial<TextStyle>;
  duration?: number;
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: "title", name: "Title", text: "Your Title", style: { fontFamily: "Inter", fontWeight: 700, fontSize: 120, shadowBlur: 20 } },
  { id: "ar-title", name: "Arabic title", text: "عنوان رئيسي", style: { fontFamily: "Cairo", fontWeight: 900, fontSize: 130, shadowBlur: 20 } },
  { id: "subtitle", name: "Subtitle", text: "Subtitle text", style: { fontFamily: "Inter", fontWeight: 600, fontSize: 56, y: 0.86, backgroundOpacity: 0.55, backgroundPadding: 18, backgroundRadius: 10, shadowBlur: 0, shadowOffsetY: 0 } },
  { id: "ar-subtitle", name: "Arabic subtitle", text: "ترجمة نصية باللغة العربية", style: { fontFamily: "Tajawal", fontWeight: 700, fontSize: 60, y: 0.86, backgroundOpacity: 0.55, backgroundPadding: 18, backgroundRadius: 10, shadowBlur: 0, shadowOffsetY: 0 } },
  {
    id: "lower-third",
    name: "Lower third",
    text: "Jane Doe\nCreative Director",
    style: { fontFamily: "Inter", fontWeight: 700, fontSize: 52, align: "start", x: 0.24, y: 0.8, backgroundColor: "#7c3aed", backgroundOpacity: 0.9, backgroundPadding: 22, backgroundRadius: 6, shadowBlur: 0, shadowOffsetY: 0, maxWidth: 0.4 },
    duration: 5,
  },
  {
    id: "ar-lower-third",
    name: "Arabic lower third",
    text: "محمد أحمد\nمدير المشروع",
    style: { fontFamily: "Cairo", fontWeight: 700, fontSize: 54, align: "start", x: 0.76, y: 0.8, backgroundColor: "#0d9488", backgroundOpacity: 0.9, backgroundPadding: 22, backgroundRadius: 6, shadowBlur: 0, shadowOffsetY: 0, maxWidth: 0.4 },
    duration: 5,
  },
  { id: "outline", name: "Bold outline", text: "BIG NEWS", style: { fontFamily: "Bebas Neue", fontWeight: 400, fontSize: 180, color: "#facc15", outlineColor: "#000000", outlineWidth: 6, shadowBlur: 0, letterSpacing: 4 } },
  { id: "elegant", name: "Elegant", text: "Chapter One", style: { fontFamily: "Playfair Display", fontWeight: 400, italic: true, fontSize: 110, shadowBlur: 24 } },
  { id: "naskh", name: "Naskh calligraphy", text: "بسم الله نبدأ", style: { fontFamily: "Amiri", fontWeight: 700, fontSize: 130, color: "#fde68a", shadowBlur: 18 } },
  { id: "numbers", name: "Arabic numerals", text: "العدد ٢٠٢٦ — 2026", style: { fontFamily: "Noto Naskh Arabic", fontWeight: 700, fontSize: 90 } },
];

function SubtitleFiles() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const textTracks = project.tracks.filter((tr) => tr.kind === "text" && Object.values(project.clips).some((c) => c.trackId === tr.id));
  const [track, setTrack] = useState("");
  const cur = textTracks.find((x) => x.id === track) ?? textTracks[0];
  const importFile = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: t("Subtitles"), extensions: ["srt", "vtt"] }] });
    if (typeof f !== "string") return;
    try {
      const cues = parseSubtitles(await api.readTextFile(f));
      if (!cues.length) throw new Error(t("No subtitle lines found in the file."));
      addSubtitleTrack(cues, f.split(/[\\/]/).pop()?.replace(/\.(srt|vtt)$/i, "") ?? t("Subtitles"));
      useApp.getState().toast(t("{{n}} subtitle lines imported", { n: cues.length }), "success");
    } catch (e) {
      useApp.getState().toast(errorText(e), "error");
    }
  };
  const exportFile = async (fmt: "srt" | "vtt") => {
    if (!cur) return;
    const clips = Object.values(project.clips).filter((c) => c.trackId === cur.id && isTextClip(c));
    const path = await saveDialog({ defaultPath: `${project.name}.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
    if (!path) return;
    const cues = cuesFromClips(clips.filter(isTextClip));
    await api.writeTextFile(path, fmt === "srt" ? toSrt(cues) : toVtt(cues));
    useApp.getState().toast(t("Subtitles saved"), "success");
  };
  return (
    <div className="mb-4 space-y-2 rounded-lg border border-line p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Subtitle files")}</div>
      <Button className="w-full" onClick={importFile}>
        <FileDown size={14} />
        {t("Import SRT / VTT…")}
      </Button>
      {cur && (
        <div className="flex gap-1.5">
          <Select value={cur.id} onChange={setTrack} options={textTracks.map((x) => ({ value: x.id, label: x.name }))} />
          <Button onClick={() => exportFile("srt")} title={t("Export track as SRT")}>
            <FileUp size={13} />
            SRT
          </Button>
          <Button onClick={() => exportFile("vtt")} title={t("Export track as VTT")}>
            VTT
          </Button>
        </div>
      )}
    </div>
  );
}

export default function TextPanel() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto p-2.5">
      <SubtitleFiles />
      <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Text templates")}</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
        {TEXT_PRESETS.map((p) => (
          <button
            key={p.id}
            onPointerDown={(e) => beginDrag(e, { kind: "text", text: p.text, style: p.style, duration: p.duration }, p.text.split("\n")[0])}
            onClick={() => addText(p.text, p.style, p.duration)}
            className="group relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-md border border-line bg-gradient-to-br from-panel-3 to-panel-2 p-2 hover:border-accent"
            title={t("Click to add at the playhead, or drag to the timeline")}
          >
            <span
              dir="auto"
              className="line-clamp-2 text-center leading-tight"
              style={{
                fontFamily: `"${p.style.fontFamily}"`,
                fontWeight: p.style.fontWeight,
                fontStyle: p.style.italic ? "italic" : undefined,
                color: p.style.color ?? "#fff",
                fontSize: 17,
                WebkitTextStroke: p.style.outlineWidth ? `1px ${p.style.outlineColor}` : undefined,
                background: p.style.backgroundOpacity ? p.style.backgroundColor ?? "#000" : undefined,
                padding: p.style.backgroundOpacity ? "2px 6px" : undefined,
                borderRadius: 4,
              }}
            >
              {p.text.split("\n")[0]}
            </span>
            <span className="absolute bottom-1 start-1.5 text-[10px] text-dim">{t(p.name)}</span>
            <Plus size={14} className="absolute end-1.5 top-1.5 text-dim opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
