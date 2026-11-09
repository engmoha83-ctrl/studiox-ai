import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Check, Cpu, LoaderCircle, ScanSearch, Scissors, X } from "lucide-react";
import { api, errorText } from "../../backend/api";
import * as ops from "../../engine/timelineOps";
import { shortTime } from "../../lib/time";
import { useApp } from "../../store/appStore";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { isMediaClip, type MediaClip } from "../../types/project";
import { Button, NumberField, Row, Section } from "../common/ui";
import SubtitlesAI from "./SubtitlesAI";

interface Proposal {
  kind: "silence" | "scenes";
  clipId: string;
  ranges?: { start: number; end: number }[];
  cuts?: number[];
}

/** Local analysis tools (FFmpeg signal analysis – nothing leaves the computer). */
export default function AIPanel() {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const selection = useUi((s) => s.selection);
  const toast = useApp((s) => s.toast);
  const clip = selection.length === 1 && isMediaClip(project.clips[selection[0]]) ? (project.clips[selection[0]] as MediaClip) : null;
  const media = clip ? project.media.find((m) => m.id === clip.mediaId) : undefined;
  const [noise, setNoise] = useState(-35);
  const [minDur, setMinDur] = useState(0.6);
  const [pad, setPad] = useState(0.12);
  const [scene, setScene] = useState(0.3);
  const [busy, setBusy] = useState<"silence" | "scenes" | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const toTimeline = (c: MediaClip, src: number) => c.start + (src - c.in) / c.speed;

  const runSilence = async () => {
    if (!clip || !media) return;
    setBusy("silence");
    setProposal(null);
    try {
      const found = await api.detectSilence(media.path, noise, minDur);
      const srcEnd = clip.in + clip.duration * clip.speed;
      const ranges = found
        .map((r) => ({ start: Math.max(r.start, clip.in), end: Math.min(r.end < 0 ? media.duration : r.end, srcEnd) }))
        .filter((r) => r.end - r.start > 0)
        .map((r) => ({
          start: toTimeline(clip, r.start) + (r.start > clip.in + 1e-3 ? pad : 0),
          end: toTimeline(clip, r.end) - (r.end < srcEnd - 1e-3 ? pad : 0),
        }))
        .filter((r) => r.end - r.start >= 0.1);
      setProposal({ kind: "silence", clipId: clip.id, ranges });
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const runScenes = async () => {
    if (!clip || !media) return;
    setBusy("scenes");
    setProposal(null);
    try {
      const found = await api.detectScenes(media.path, scene);
      const srcEnd = clip.in + clip.duration * clip.speed;
      const cuts = found.filter((s) => s > clip.in + 0.2 && s < srcEnd - 0.2).map((s) => toTimeline(clip, s));
      setProposal({ kind: "scenes", clipId: clip.id, cuts });
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const approve = () => {
    if (!proposal) return;
    const { commit } = useProject.getState();
    if (proposal.kind === "silence" && proposal.ranges?.length) {
      let removed = 0;
      commit(t("Remove silence"), (d) => {
        removed = ops.removeRanges(d, proposal.clipId, proposal.ranges!, true);
      });
      toast(t("Removed {{s}} of silence", { s: shortTime(removed) }), "success");
      useUi.getState().select([]);
    }
    if (proposal.kind === "scenes" && proposal.cuts?.length) {
      commit(t("Split at scene changes"), (d) => {
        let current = proposal.clipId;
        for (const cut of proposal.cuts!) {
          const r = ops.splitClip(d, current, cut);
          if (r) current = r;
        }
      });
      toast(t("Split into {{n}} clips", { n: proposal.cuts.length + 1 }), "success");
    }
    setProposal(null);
  };

  const total = proposal?.ranges?.reduce((a, r) => a + r.end - r.start, 0) ?? 0;

  return (
    <div className="h-full overflow-auto">
      <div className="m-2.5 flex items-start gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 p-2.5 text-[11.5px] text-teal-100">
        <Cpu size={15} className="mt-0.5 shrink-0" />
        <span>{t("These tools run locally with FFmpeg. Your media never leaves this computer.")}</span>
      </div>
      <SubtitlesAI />
      {!clip && <p className="px-3 pb-2 pt-2 text-[12px] text-muted">{t("Select one video or audio clip on the timeline to analyse it.")}</p>}

      <Section title={t("Silence detection")} right={<AudioLines size={14} className="text-dim" />}>
        <Row label={t("Threshold")}>
          <NumberField value={noise} onChange={setNoise} min={-80} max={-5} step={1} suffix="dB" precision={0} />
        </Row>
        <Row label={t("Min. length")}>
          <NumberField value={minDur} onChange={setMinDur} min={0.1} max={10} step={0.05} suffix="s" />
        </Row>
        <Row label={t("Keep padding")}>
          <NumberField value={pad} onChange={setPad} min={0} max={1} step={0.01} suffix="s" />
        </Row>
        <Button className="w-full" disabled={!clip || !media?.hasAudio || !!busy} onClick={runSilence}>
          {busy === "silence" ? <LoaderCircle size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          {t("Detect silent parts")}
        </Button>
      </Section>

      <Section title={t("Scene change detection")} right={<Scissors size={14} className="text-dim" />}>
        <Row label={t("Sensitivity")}>
          <NumberField value={scene} onChange={setScene} min={0.05} max={0.9} step={0.01} />
        </Row>
        <Button className="w-full" disabled={!clip || media?.kind !== "video" || !!busy} onClick={runScenes}>
          {busy === "scenes" ? <LoaderCircle size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          {t("Detect scene changes")}
        </Button>
      </Section>

      {proposal && (
        <div className="anim-in m-2.5 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <div className="mb-1.5 font-semibold">{t("Suggested change")}</div>
          {proposal.kind === "silence" ? (
            <p className="text-[12px] text-muted">
              {proposal.ranges!.length
                ? t("{{n}} silent parts found ({{s}}). They will be cut out and the gaps closed.", { n: proposal.ranges!.length, s: shortTime(total) })
                : t("No silent parts found with these settings.")}
            </p>
          ) : (
            <p className="text-[12px] text-muted">{proposal.cuts!.length ? t("{{n}} scene changes found. The clip will be split at each one.", { n: proposal.cuts!.length }) : t("No scene changes found with these settings.")}</p>
          )}
          <div className="mt-2 max-h-32 overflow-auto text-[11px] tabular-nums text-dim" dir="ltr">
            {proposal.ranges?.map((r, i) => (
              <div key={i}>
                {r.start.toFixed(2)}s → {r.end.toFixed(2)}s
              </div>
            ))}
            {proposal.cuts?.map((c, i) => <div key={i}>✂ {c.toFixed(2)}s</div>)}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="flex-1" disabled={!(proposal.ranges?.length || proposal.cuts?.length)} onClick={approve}>
              <Check size={14} />
              {t("Apply")}
            </Button>
            <Button variant="ghost" onClick={() => setProposal(null)}>
              <X size={14} />
              {t("Discard")}
            </Button>
          </div>
          <p className="mt-2 text-[10.5px] text-dim">{t("Original media is never modified. You can undo this step.")}</p>
        </div>
      )}
    </div>
  );
}
