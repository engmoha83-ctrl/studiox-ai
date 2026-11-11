import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Check, CircleAlert, CircleCheck, LoaderCircle, Sparkles, X } from "lucide-react";
import { errorText } from "../../backend/api";
import type { AssistantOp } from "../../engine/assistantParse";
import { describeOp, execute, understand, type AssistantPlan, type StepResult } from "../../services/assistant";
import { refreshAiStatus, useAi } from "../../services/ai";
import { useApp } from "../../store/appStore";
import { Button, Section, Select } from "../common/ui";

const EXAMPLES_AR = ["احذف الصمت وحوّله لتيك توك", "ضيف ترجمة عربي وانتقالات", "شكل احترافي", "لون سينمائي ومربع"];
const EXAMPLES_EN = ["Remove silence and make it a TikTok", "Add subtitles and transitions", "Make it look professional", "Black and white, square"];

/** The AI editing assistant: request → proposed plan → approval → undoable steps. */
export default function AssistantAI() {
  const { t, i18n } = useTranslation();
  const status = useAi((s) => s.status);
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState("");
  const [model, setModel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [enabled, setEnabled] = useState<boolean[]>([]);
  const [running, setRunning] = useState<{ index: number; status: string } | null>(null);
  const [results, setResults] = useState<StepResult[] | null>(null);
  useEffect(() => void refreshAiStatus(), []);

  const ollama = status?.ollama ?? [];
  const examples = i18n.language.startsWith("ar") ? EXAMPLES_AR : EXAMPLES_EN;

  const ask = async (req = text) => {
    if (!req.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      const p = await understand(req, model || null);
      setPlan(p);
      setEnabled(p.ops.map(() => true));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!plan) return;
    const chosen: AssistantOp[] = plan.ops.filter((_, i) => enabled[i]);
    if (!chosen.length) return;
    setBusy(true);
    try {
      const res = await execute({ ...plan, ops: chosen }, (index, s) => setRunning({ index, status: s }));
      setResults(res);
      setPlan(null);
      const bad = res.filter((r) => !r.ok).length;
      toast(bad ? t("{{n}} of {{m}} steps failed", { n: bad, m: res.length }) : t("Done – each step can be undone"), bad ? "error" : "success");
    } finally {
      setRunning(null);
      setBusy(false);
    }
  };

  return (
    <Section title={t("AI assistant")} right={<Bot size={14} className="text-dim" />}>
      <textarea
        data-testid="assistant-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void ask();
          }
          e.stopPropagation();
        }}
        dir="auto"
        rows={2}
        placeholder={t("Tell me what to do, e.g. “remove silence and make it vertical”")}
        className="w-full resize-none rounded-md border border-line-2 bg-panel-2 px-2 py-1.5 text-[12px] outline-none focus:border-accent"
      />
      <div className="flex flex-wrap gap-1">
        {examples.map((ex) => (
          <button
            key={ex}
            dir="auto"
            onClick={() => {
              setText(ex);
              void ask(ex);
            }}
            className="rounded-full border border-line-2 px-2 py-0.5 text-[10.5px] text-muted hover:border-accent hover:text-white"
          >
            {ex}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Select
          className="flex-1"
          value={model}
          onChange={setModel}
          options={[{ value: "", label: t("Built-in commands (offline)") }, ...ollama.map((m) => ({ value: m, label: `Ollama · ${m}` }))]}
        />
        <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void ask()} testId="assistant-ask">
          {busy && !running ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {t("Suggest")}
        </Button>
      </div>
      {!ollama.length && <p className="text-[10.5px] text-dim">{t("Optional: install Ollama with a model on this computer to understand free-form requests. Nothing is sent to the internet.")}</p>}

      {plan && (
        <div className="anim-in rounded-lg border border-accent/40 bg-accent/10 p-2.5" data-testid="assistant-plan">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold">{t("Suggested steps")}</span>
            <span className="text-[10.5px] text-dim">{plan.provider === "built-in" ? t("Built-in commands") : `Ollama · ${plan.provider}`}</span>
          </div>
          {plan.note && <p className="mb-1 text-[11px] text-amber-200">{plan.note}</p>}
          {plan.ops.length === 0 ? (
            <p className="text-[11.5px] text-muted">
              {t("I couldn't match that to an editing step. I understand: remove silence, split scenes, speed, transitions, colour looks, TikTok/Reels/square/YouTube format, subtitles, title, export.")}
            </p>
          ) : (
            <ol className="space-y-1">
              {plan.ops.map((o, i) => (
                <li key={o.op} className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" className="mt-0.5 accent-[var(--accent,#7c5cff)]" checked={enabled[i] ?? true} onChange={(e) => setEnabled((v) => v.map((x, j) => (j === i ? e.target.checked : x)))} />
                  <span className={enabled[i] ? "" : "text-dim line-through"}>
                    {i + 1}. {describeOp(o)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {running && (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-teal-100">
              <LoaderCircle size={13} className="animate-spin" />
              {running.index + 1}. {running.status}
            </p>
          )}
          <div className="mt-2.5 flex gap-2">
            <Button variant="primary" className="flex-1" disabled={busy || !plan.ops.some((_, i) => enabled[i])} onClick={() => void approve()} testId="assistant-apply">
              <Check size={14} />
              {t("Apply")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPlan(null)}>
              <X size={14} />
              {t("Discard")}
            </Button>
          </div>
          <p className="mt-1.5 text-[10.5px] text-dim">{t("Nothing changes until you press Apply. Each step is separate in the undo history.")}</p>
        </div>
      )}

      {results && (
        <div className="space-y-1 rounded-lg border border-line-2 p-2" data-testid="assistant-results">
          {results.map((r) => (
            <div key={r.op.op} className="flex items-start gap-1.5 text-[11.5px]">
              {r.ok ? <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-400" /> : <CircleAlert size={13} className="mt-0.5 shrink-0 text-red-400" />}
              <span>
                <span className="text-muted">{describeOp(r.op)}:</span> {r.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
