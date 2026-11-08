import { useTranslation } from "react-i18next";
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

export default function TextPanel() {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-auto p-2.5">
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
