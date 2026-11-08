import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ------------------------------------------------------------------ buttons

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 h-8 text-[13px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap",
        variant === "primary" && "grad-bg text-white hover:brightness-110 shadow-sm shadow-violet-900/40",
        variant === "default" && "bg-panel-3 hover:bg-line-2 text-fg border border-line-2",
        variant === "ghost" && "hover:bg-panel-3 text-muted hover:text-fg",
        variant === "danger" && "bg-red-600/90 hover:bg-red-500 text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconBtn({
  children,
  tip,
  onClick,
  active,
  disabled,
  className,
  shortcut,
}: {
  children: ReactNode;
  tip: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  shortcut?: string;
}) {
  return (
    <Tooltip text={tip} shortcut={shortcut}>
      <button
        type="button"
        aria-label={tip}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "inline-flex items-center justify-center rounded-md size-7 transition-colors disabled:opacity-30 disabled:pointer-events-none",
          active ? "bg-accent/25 text-violet-200" : "text-muted hover:text-fg hover:bg-panel-3",
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Tooltip({ text, shortcut, children, side = "bottom" }: { text: string; shortcut?: string; children: ReactNode; side?: "bottom" | "top" }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => (timer.current = setTimeout(() => setShow(true), 450))}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setShow(false);
      }}
      onMouseDown={() => {
        clearTimeout(timer.current);
        setShow(false);
      }}
    >
      {children}
      {show && (
        <span
          className={cx(
            "pointer-events-none absolute left-1/2 -translate-x-1/2 z-[100] whitespace-nowrap rounded-md bg-black/95 border border-line-2 px-2 py-1 text-[11px] text-fg shadow-lg anim-in",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {text}
          {shortcut && <kbd className="ms-2 text-[10px] text-muted font-mono">{shortcut}</kbd>}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="anim-in flex max-h-[88vh] flex-col rounded-xl border border-line-2 bg-panel shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 h-11">
          <div className="font-semibold">{title}</div>
          <IconBtn tip={t("Close")} onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ prompt / confirm

interface DialogReq {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  value?: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}
const useDialogs = create<{ req: DialogReq | null }>(() => ({ req: null }));

export function promptText(title: string, value = "", message?: string): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ req: { kind: "prompt", title, value, message, resolve: (v) => resolve(v as string | null) } }));
}
export function confirmAction(title: string, message: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => useDialogs.setState({ req: { kind: "confirm", title, message, danger, resolve: (v) => resolve(!!v) } }));
}

export function DialogHost() {
  const { t } = useTranslation();
  const req = useDialogs((s) => s.req);
  const [val, setVal] = useState("");
  useEffect(() => setVal(req?.value ?? ""), [req]);
  if (!req) return null;
  const done = (v: string | boolean | null) => {
    useDialogs.setState({ req: null });
    req.resolve(v);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(req.kind === "prompt" ? null : false)}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => done(req.kind === "prompt" ? null : false)}>
            {t("Cancel")}
          </Button>
          <Button variant={req.danger ? "danger" : "primary"} onClick={() => done(req.kind === "prompt" ? val : true)}>
            {req.kind === "prompt" ? t("OK") : t("Confirm")}
          </Button>
        </>
      }
    >
      {req.message && <p className="mb-3 text-muted whitespace-pre-line">{req.message}</p>}
      {req.kind === "prompt" && (
        <input
          autoFocus
          dir="auto"
          className="w-full rounded-md border border-line-2 bg-panel-2 px-3 h-9 outline-none focus:border-accent"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && done(val)}
        />
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ context menu

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}
const useMenu = create<{ x: number; y: number; items: MenuItem[] | null }>(() => ({ x: 0, y: 0, items: null }));

export function openContextMenu(e: React.MouseEvent | MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.setState({ x: e.clientX, y: e.clientY, items });
}

export function ContextMenuHost() {
  const { x, y, items } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!items) return;
    const close = () => useMenu.setState({ items: null });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [items]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y, items]);
  if (!items) return null;
  return (
    <div
      ref={ref}
      className="anim-in fixed z-[120] min-w-[200px] rounded-lg border border-line-2 bg-panel-2 p-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            className={cx(
              "flex w-full items-center gap-2 rounded-md px-2.5 h-7 text-start text-[12.5px] disabled:opacity-35",
              it.danger ? "text-red-300 hover:bg-red-500/15" : "hover:bg-accent/20",
            )}
            onClick={() => {
              useMenu.setState({ items: null });
              it.onClick?.();
            }}
          >
            <span className="w-4 text-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <kbd className="text-[10.5px] text-dim font-mono">{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

// ------------------------------------------------------------------ form controls

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
        {right}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-[88px] shrink-0 text-[12px] text-muted truncate" title={label}>
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

/** Number input that can also be scrubbed by dragging its label area. */
export function NumberField({
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  precision = 2,
  suffix,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const shown = text ?? String(+value.toFixed(precision));
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const v0 = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      if (moved) onChange(clamp(+(v0 + dx * step * (ev.shiftKey ? 10 : 1)).toFixed(precision)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={cx("flex h-7 items-center rounded-md border border-line-2 bg-panel-2 focus-within:border-accent", className)}>
      <span className="h-full w-2 cursor-ew-resize" onPointerDown={startDrag} />
      <input
        dir="ltr"
        className="h-full w-full min-w-0 bg-transparent text-[12px] outline-none tabular-nums"
        value={shown}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = parseFloat(text);
            if (!Number.isNaN(v)) onChange(clamp(v));
          }
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(+(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(precision)));
          }
          e.stopPropagation();
        }}
      />
      {suffix && <span className="pe-2 text-[11px] text-dim">{suffix}</span>}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  precision = 2,
  suffix,
  display,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  suffix?: string;
  display?: (v: number) => number;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <input dir="ltr" type="range" className="min-w-0 flex-1" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <NumberField
        className="w-[68px]"
        value={display ? display(value) : value}
        onChange={(v) => onChange(display ? (v / display(1)) : v)}
        min={display ? display(min) : min}
        max={display ? display(max) : max}
        step={display ? step * display(1) : step}
        precision={precision}
        suffix={suffix}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative inline-block h-[18px] w-8 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-2")}
      >
        <span className={cx("absolute top-[2px] size-[14px] rounded-full bg-white transition-all", checked ? "start-[16px]" : "start-[2px]")} />
      </span>
      {label && <span className="text-[12px]">{label}</span>}
    </label>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  className?: string;
}) {
  return (
    <select
      className={cx("h-7 w-full min-w-0 rounded-md border border-line-2 bg-panel-2 px-2 text-[12px] outline-none focus:border-accent", className)}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled} className="bg-panel-2">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Empty({ icon, text, children }: { icon: ReactNode; text: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted">
      <div className="text-dim">{icon}</div>
      <div className="max-w-[240px] text-[12.5px] leading-relaxed">{text}</div>
      {children}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-line-2", className)}>
      <div className="h-full grad-bg transition-[width] duration-200" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}
