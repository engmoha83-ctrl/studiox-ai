import { useTranslation } from "react-i18next";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronDown, CircleCheck, CircleX, FolderOpen, ListVideo, LoaderCircle, X } from "lucide-react";
import { cancelExport, clearFinishedExports } from "../../services/exporter";
import { useApp } from "../../store/appStore";
import { shortTime } from "../../lib/time";
import { IconBtn, ProgressBar, cx } from "../common/ui";

/** Floating background-render queue. */
export default function ExportQueue() {
  const { t } = useTranslation();
  const jobs = useApp((s) => s.exports);
  const open = useApp((s) => s.dialogs.queue);
  const setOpen = (v: boolean) => useApp.getState().openDialog("queue", v);
  if (!jobs.length) return null;
  const active = jobs.filter((j) => j.status === "running" || j.status === "preparing" || j.status === "queued");
  const running = jobs.find((j) => j.status === "running" || j.status === "preparing");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-4 start-4 z-[70] flex items-center gap-2 rounded-full border border-line-2 bg-panel-2 px-3.5 py-2 shadow-xl hover:bg-panel-3">
        {running ? <LoaderCircle size={15} className="animate-spin text-violet-300" /> : <ListVideo size={15} />}
        <span className="text-[12px]">{active.length ? t("Exporting {{n}}", { n: active.length }) : t("Exports")}</span>
        {running && <span className="text-[12px] tabular-nums text-violet-200">{Math.round(running.progress * 100)}%</span>}
      </button>
    );
  return (
    <div className="anim-in fixed bottom-4 start-4 z-[70] w-[400px] rounded-xl border border-line-2 bg-panel-2 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-line px-3 h-10">
        <ListVideo size={15} />
        <span className="flex-1 font-semibold">{t("Export queue")}</span>
        <button className="text-[11.5px] text-muted hover:text-fg" onClick={clearFinishedExports}>
          {t("Clear finished")}
        </button>
        <IconBtn tip={t("Minimise")} onClick={() => setOpen(false)}>
          <ChevronDown size={15} />
        </IconBtn>
      </div>
      <div className="max-h-[320px] space-y-1 overflow-auto p-2">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-lg bg-panel px-3 py-2">
            <div className="flex items-center gap-2">
              {j.status === "done" ? (
                <CircleCheck size={15} className="text-emerald-400" />
              ) : j.status === "error" || j.status === "cancelled" ? (
                <CircleX size={15} className={j.status === "error" ? "text-red-400" : "text-dim"} />
              ) : (
                <LoaderCircle size={15} className={cx(j.status !== "queued" && "animate-spin", "text-violet-300")} />
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px]" dir="auto" title={j.outputPath}>
                {j.name}
              </span>
              {j.status === "done" && (
                <IconBtn tip={t("Show in folder")} onClick={() => void revealItemInDir(j.outputPath)}>
                  <FolderOpen size={14} />
                </IconBtn>
              )}
              {(j.status === "running" || j.status === "queued" || j.status === "preparing") && (
                <IconBtn tip={t("Cancel")} onClick={() => void cancelExport(j.id)}>
                  <X size={14} />
                </IconBtn>
              )}
            </div>
            {(j.status === "running" || j.status === "preparing") && (
              <>
                <ProgressBar value={j.progress} className="mt-2" />
                <div className="mt-1 flex justify-between text-[11px] text-dim tabular-nums" dir="ltr">
                  <span>
                    {Math.round(j.progress * 100)}% {j.fps ? `· ${Math.round(j.fps)} fps` : ""} {j.speed ? `· ${j.speed}` : ""}
                  </span>
                  <span>{j.status === "preparing" ? t("Preparing…") : j.eta != null ? `${t("Remaining")} ${shortTime(j.eta)}` : ""}</span>
                </div>
              </>
            )}
            {j.status === "queued" && <div className="mt-1 text-[11px] text-dim">{t("Waiting in queue")}</div>}
            {j.status === "done" && j.finishedAt && j.startedAt && (
              <div className="mt-1 text-[11px] text-dim">
                {t("Finished in {{s}}", { s: shortTime((j.finishedAt - j.startedAt) / 1000) })}
              </div>
            )}
            {j.status === "error" && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10.5px] text-red-300" dir="ltr">{j.message}</pre>}
            {j.status === "cancelled" && <div className="mt-1 text-[11px] text-dim">{t("Cancelled — partial file removed")}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
