// Canvas-drawn layer overlays shared by the preview and the export (rasterised to PNG):
// vignette and masks. Drawing them with the same code guarantees identical results.
import type { Mask } from "../types/project";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Darkening vignette: transparent centre → black edges (alpha = amount). */
export function drawVignette(ctx: Ctx, w: number, h: number, amount: number) {
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${Math.max(0, Math.min(1, amount))})`);
  ctx.save();
  // ellipse-shaped falloff that follows the frame aspect
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / Math.hypot(w, h), h / Math.hypot(w, h));
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h, w * 3, h * 3);
  ctx.restore();
}

/** White shape whose alpha is the mask (feathered, optionally inverted). */
export function drawMask(ctx: Ctx, w: number, h: number, m: Mask) {
  const feather = Math.max(0, m.feather) * Math.min(w, h);
  const cx = m.x * w;
  const cy = m.y * h;
  const mw = Math.max(1, m.w * w);
  const mh = Math.max(1, m.h * h);
  const shape = (c: Ctx) => {
    c.beginPath();
    if (m.shape === "ellipse") c.ellipse(cx, cy, mw / 2, mh / 2, 0, 0, Math.PI * 2);
    else c.rect(cx - mw / 2, cy - mh / 2, mw, mh);
  };
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (feather > 0.5 && "filter" in ctx) (ctx as CanvasRenderingContext2D).filter = `blur(${feather / 2}px)`;
  if (m.invert) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(-feather * 2, -feather * 2, w + feather * 4, h + feather * 4);
    ctx.globalCompositeOperation = "destination-out";
  }
  ctx.fillStyle = "#fff";
  shape(ctx);
  ctx.fill();
  ctx.restore();
}

/** Black bars (fraction of height in total). */
export function drawLetterbox(ctx: Ctx, w: number, h: number, amount: number) {
  const bar = Math.round(h * Math.min(0.45, amount * 0.5));
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, bar);
  ctx.fillRect(0, h - bar, w, bar);
  ctx.restore();
}

export async function canvasPng(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<string> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  return c.toDataURL("image/png").split(",")[1];
}
