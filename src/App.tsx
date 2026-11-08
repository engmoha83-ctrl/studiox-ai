import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { api, isTauri, setMediaBase, onJobCancelled, onJobDone, onJobError, onJobProgress } from "./backend/api";
import { applyLanguage } from "./i18n";
import { useApp } from "./store/appStore";
import { useUi } from "./store/uiStore";
import { onExportEnd, onExportProgress } from "./services/exporter";
import { handleProxyEnd, handleProxyProgress } from "./services/media";
import { ContextMenuHost, DialogHost, cx } from "./components/common/ui";
import HomeScreen from "./components/home/HomeScreen";
import Editor from "./components/editor/Editor";
import SettingsDialog from "./components/settings/SettingsDialog";
import { installTestHooks } from "./testHooks";

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[150] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "anim-in pointer-events-auto flex items-start gap-2 rounded-lg border bg-panel-2 px-3 py-2.5 shadow-xl",
            t.kind === "error" ? "border-red-500/40" : t.kind === "success" ? "border-emerald-500/40" : "border-line-2",
          )}
        >
          <span className="mt-0.5">
            {t.kind === "error" ? <CircleX size={16} className="text-red-400" /> : t.kind === "success" ? <CircleCheck size={16} className="text-emerald-400" /> : <Info size={16} className="text-violet-300" />}
          </span>
          <div className="flex-1 whitespace-pre-line break-words text-[12.5px] leading-snug">{t.text}</div>
          <button className="text-muted hover:text-fg" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const screen = useApp((s) => s.screen);
  const settingsOpen = useApp((s) => s.dialogs.settings);

  useEffect(() => {
    if (!isTauri()) return;
    installTestHooks();
    const set = useApp.getState().set;
    void (async () => {
      const lang = (await api.getSetting("language").catch(() => null)) as "en" | "ar" | null;
      const l = lang ?? (navigator.language.startsWith("ar") ? "ar" : "en");
      applyLanguage(l);
      set({ language: l });
      const autoProxy = await api.getSetting("autoProxy").catch(() => null);
      if (autoProxy !== null) set({ autoProxy: autoProxy === "1" });
      const info = await api.appInfo();
      setMediaBase(info.mediaBase);
      set({ info });
      const sys = await api.systemInfo();
      set({ system: sys });
      // First launch: adapt defaults to the detected hardware profile.
      const configured = await api.getSetting("profileConfigured");
      const q = await api.getSetting("previewQuality");
      if (!configured) {
        const quality = sys.profile === "low" ? 0.5 : 1;
        await api.setSetting("previewQuality", String(quality));
        await api.setSetting("autoProxy", sys.profile === "high" ? "0" : "1");
        await api.setSetting("profileConfigured", sys.profile);
        set({ autoProxy: sys.profile !== "high" });
        useUi.getState().set({ previewQuality: quality as 1 | 0.5 });
      } else if (q) useUi.getState().set({ previewQuality: (parseFloat(q) || 1) as 1 | 0.5 | 0.25 });
    })();
    const subs = [
      onJobProgress((p) => {
        if (p.kind === "proxy") handleProxyProgress(p.id, p.progress);
        else onExportProgress(p.id, p.progress, p.eta, p.fps, p.speed);
      }),
      onJobDone((e) => (e.kind === "proxy" ? handleProxyEnd(e.id, e.output) : onExportEnd(e.id, "done"))),
      onJobError((e) => (e.kind === "proxy" ? handleProxyEnd(e.id, null, e.message) : onExportEnd(e.id, "error", e.message))),
      onJobCancelled((e) => (e.kind === "proxy" ? handleProxyEnd(e.id, null) : onExportEnd(e.id, "cancelled"))),
    ];
    const noMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("input,textarea")) e.preventDefault();
    };
    window.addEventListener("contextmenu", noMenu);
    return () => {
      subs.forEach((s) => void s.then((u) => u()));
      window.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  if (!isTauri()) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-muted">
        <div>
          <img src="/logo.png" className="mx-auto mb-4 size-16" />
          <div className="text-lg font-semibold text-fg">StudioX AI</div>
          <p className="mt-2">{t("This interface runs inside the StudioX AI desktop application.")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {screen === "home" ? <HomeScreen /> : <Editor />}
      {settingsOpen && <SettingsDialog />}
      <ContextMenuHost />
      <DialogHost />
      <Toasts />
    </>
  );
}
