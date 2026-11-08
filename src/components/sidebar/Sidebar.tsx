import { useTranslation } from "react-i18next";
import { ArrowRightLeft, AudioLines, Film, Type, WandSparkles } from "lucide-react";
import { useUi, type LeftTab } from "../../store/uiStore";
import { cx } from "../common/ui";
import MediaPanel from "./MediaPanel";
import TextPanel from "./TextPanel";
import TransitionsPanel from "./TransitionsPanel";
import AIPanel from "./AIPanel";

export default function Sidebar({ importMedia }: { importMedia: () => void }) {
  const { t } = useTranslation();
  const tab = useUi((s) => s.leftTab);
  const set = useUi((s) => s.set);
  const tabs: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
    { id: "media", label: t("Media"), icon: <Film size={18} /> },
    { id: "audio", label: t("Audio"), icon: <AudioLines size={18} /> },
    { id: "text", label: t("Text"), icon: <Type size={18} /> },
    { id: "transitions", label: t("Transitions"), icon: <ArrowRightLeft size={18} /> },
    { id: "ai", label: t("AI tools"), icon: <WandSparkles size={18} /> },
  ];
  return (
    <div className="flex h-full bg-panel">
      <div className="flex w-[64px] shrink-0 flex-col items-center gap-1 border-e border-line py-2">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => set({ leftTab: x.id })}
            className={cx("flex w-[56px] flex-col items-center gap-1 rounded-lg py-2 text-[10.5px]", tab === x.id ? "bg-accent/15 text-violet-200" : "text-muted hover:bg-panel-3 hover:text-fg")}
          >
            {x.icon}
            <span className="leading-none">{x.label}</span>
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        {tab === "media" && <MediaPanel importMedia={importMedia} />}
        {tab === "audio" && <MediaPanel importMedia={importMedia} onlyKind="audio" />}
        {tab === "text" && <TextPanel />}
        {tab === "transitions" && <TransitionsPanel />}
        {tab === "ai" && <AIPanel />}
      </div>
    </div>
  );
}
