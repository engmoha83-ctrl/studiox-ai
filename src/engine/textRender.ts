// Text layer renderer used by BOTH the preview and the export (rasterised to PNG).
// The browser engine (HarfBuzz) performs Arabic shaping, bidi and mixed-script layout.

import type { TextClip, TextStyle } from "../types/project";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ࣿיִ-﷿ﹰ-﻿]/;

/** Direction from the first strong character (Unicode bidi P2/P3). */
export function detectDirection(text: string): "rtl" | "ltr" {
  const m = text.match(STRONG_RE);
  return m && RTL_RE.test(m[0]) ? "rtl" : "ltr";
}

export function resolveDirection(style: TextStyle, text: string): "rtl" | "ltr" {
  return style.direction === "auto" ? detectDirection(text) : style.direction;
}

export function localiseDigits(text: string, arabic: boolean): string {
  return arabic ? text.replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d]) : text;
}

export function fontString(style: TextStyle, px: number): string {
  return `${style.italic ? "italic " : ""}${style.fontWeight} ${px}px "${style.fontFamily}", "Cairo", "Segoe UI", Tahoma, Arial, sans-serif`;
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const test = line + w;
      if (line.trim() && ctx.measureText(test).width > maxWidth) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draw a text clip onto a canvas of size W×H. `unit` = canvas px per project px.
 * `alpha`, `dx`, `dy` come from the shared animation resolver.
 * Returns the bounding box (useful for on-canvas selection).
 */
export function drawTextClip(ctx: Ctx, clip: TextClip, W: number, H: number, unit: number, alpha = 1, dx = 0, dy = 0): TextBox {
  const s = clip.style;
  const text = localiseDigits(clip.text || " ", s.arabicDigits);
  const dir = resolveDirection(s, text);
  const px = Math.max(1, s.fontSize * unit);
  ctx.save();
  ctx.font = fontString(s, px);
  (ctx as any).direction = dir;
  if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${s.letterSpacing * unit}px`;
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text, s.maxWidth * W);
  const lineH = px * s.lineHeight;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockW = Math.max(1, ...widths);
  const blockH = lineH * lines.length;
  const pad = s.backgroundPadding * unit;
  const cx = s.x * W + dx;
  const cy = s.y * H + dy;
  const left = cx - blockW / 2;
  const top = cy - blockH / 2;
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  if (s.backgroundOpacity > 0) {
    ctx.fillStyle = hexToRgba(s.backgroundColor, s.backgroundOpacity);
    roundRect(ctx, left - pad, top - pad * 0.6, blockW + pad * 2, blockH + pad * 1.2, s.backgroundRadius * unit);
    ctx.fill();
  }
  // Logical alignment: "start" follows the text direction.
  const physical = s.align === "center" ? "center" : (s.align === "start") === (dir === "ltr") ? "left" : "right";
  ctx.textAlign = physical;
  const ax = physical === "center" ? cx : physical === "left" ? left : left + blockW;

  lines.forEach((line, i) => {
    const ly = top + lineH * (i + 0.5);
    if (s.outlineWidth > 0) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = s.outlineWidth * 2 * unit;
      ctx.strokeStyle = s.outlineColor;
      if (s.shadowBlur > 0 || s.shadowOffsetX || s.shadowOffsetY) {
        ctx.shadowColor = s.shadowColor;
        ctx.shadowBlur = s.shadowBlur * unit;
        ctx.shadowOffsetX = s.shadowOffsetX * unit;
        ctx.shadowOffsetY = s.shadowOffsetY * unit;
      }
      ctx.strokeText(line, ax, ly);
      ctx.restore();
    }
    ctx.save();
    if (s.outlineWidth <= 0 && (s.shadowBlur > 0 || s.shadowOffsetX || s.shadowOffsetY)) {
      ctx.shadowColor = s.shadowColor;
      ctx.shadowBlur = s.shadowBlur * unit;
      ctx.shadowOffsetX = s.shadowOffsetX * unit;
      ctx.shadowOffsetY = s.shadowOffsetY * unit;
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, ax, ly);
    ctx.restore();
  });
  ctx.restore();
  return { x: left - pad, y: top - pad * 0.6, w: blockW + pad * 2, h: blockH + pad * 1.2 };
}

/** Make sure a font face is loaded before rasterising (important for export). */
export async function ensureFont(style: TextStyle, text: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.load(fontString(style, 64), text || "A");
  } catch {
    /* fall back to system font */
  }
}

/** Rasterise a text clip (no animation applied) to a transparent PNG (base64, no prefix). */
export async function textClipToPng(clip: TextClip, W: number, H: number, unit: number): Promise<string> {
  await ensureFont(clip.style, clip.text);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawTextClip(ctx, { ...clip, opacity: 1 }, W, H, unit, 1, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
}
