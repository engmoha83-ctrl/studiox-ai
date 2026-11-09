// Colour pipeline. Every colour operation (adjustments, wheels, curves, presets,
// imported LUTs) is baked into ONE 3D LUT. The same LUT drives the WebGL preview
// (3D texture) and the export (FFmpeg lut3d), so both are numerically identical.

import type { ColorParams, CurvePoint } from "../types/project";

export const LUT_SIZE = 33;

export interface Lut3D {
  size: number;
  /** RGB triplets, r fastest, then g, then b (".cube" order), values 0..1 */
  data: Float32Array;
}

export function defaultColor(): ColorParams {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    hue: 0,
    lift: [0, 0, 0],
    gamma: [0, 0, 0],
    gain: [0, 0, 0],
    curves: { master: [], r: [], g: [], b: [] },
    lutPath: null,
    lutIntensity: 1,
  };
}

const isIdentityCurve = (c: CurvePoint[]) => c.length === 0 || c.every((p) => Math.abs(p.x - p.y) < 1e-4);

export function isColorIdentity(c?: ColorParams | null): boolean {
  if (!c) return true;
  const z = (v: number) => Math.abs(v) < 1e-4;
  return (
    z(c.exposure) && z(c.contrast) && z(c.highlights) && z(c.shadows) && z(c.whites) && z(c.blacks) &&
    z(c.temperature) && z(c.tint) && z(c.saturation) && z(c.vibrance) && z(c.hue) &&
    [...c.lift, ...c.gamma, ...c.gain].every(z) &&
    isIdentityCurve(c.curves.master) && isIdentityCurve(c.curves.r) && isIdentityCurve(c.curves.g) && isIdentityCurve(c.curves.b) &&
    (!c.lutPath || c.lutIntensity <= 0)
  );
}

// ------------------------------------------------------------------ curves

/** Monotone cubic (Fritsch–Carlson) interpolation through points incl. (0,0)/(1,1) defaults. */
export function curveFn(points: CurvePoint[]): (x: number) => number {
  if (isIdentityCurve(points)) return (x) => x;
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (pts[0].x > 0) pts.unshift({ x: 0, y: 0 });
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: 1 });
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6);
    m.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1e-6));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-9) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  return (x: number) => {
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[n - 1].x) return pts[n - 1].y;
    let i = 0;
    while (i < n - 2 && x > pts[i + 1].x) i++;
    const h = dx[i];
    const u = (x - pts[i].x) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    return h00 * pts[i].y + h10 * h * t[i] + h01 * pts[i + 1].y + h11 * h * t[i + 1];
  };
}

// ------------------------------------------------------------------ LUT maths

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Trilinear sample of a LUT. */
export function sampleLut(l: Lut3D, r: number, g: number, b: number): [number, number, number] {
  const n = l.size - 1;
  const fr = clamp01(r) * n;
  const fg = clamp01(g) * n;
  const fb = clamp01(b) * n;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const at = (ri: number, gi: number, bi: number, c: number) => l.data[(ri + gi * l.size + bi * l.size * l.size) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(r0, g0, b0, c) * (1 - dr) + at(r1, g0, b0, c) * dr;
    const c10 = at(r0, g1, b0, c) * (1 - dr) + at(r1, g1, b0, c) * dr;
    const c01 = at(r0, g0, b1, c) * (1 - dr) + at(r1, g0, b1, c) * dr;
    const c11 = at(r0, g1, b1, c) * (1 - dr) + at(r1, g1, b1, c) * dr;
    out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db;
  }
  return out;
}

/** Apply the parametric grade to one RGB value (0..1). */
export function gradePixel(p: ColorParams, rgb: [number, number, number], curves?: ((x: number) => number)[]): [number, number, number] {
  let [r, g, b] = rgb;
  // exposure in (approximately) linear light
  if (p.exposure) {
    const k = Math.pow(2, p.exposure);
    r = Math.pow(Math.pow(r, 2.2) * k, 1 / 2.2);
    g = Math.pow(Math.pow(g, 2.2) * k, 1 / 2.2);
    b = Math.pow(Math.pow(b, 2.2) * k, 1 / 2.2);
  }
  // white balance
  if (p.temperature || p.tint) {
    r *= 1 + 0.18 * p.temperature + 0.06 * p.tint;
    g *= 1 - 0.12 * p.tint;
    b *= 1 - 0.18 * p.temperature + 0.06 * p.tint;
  }
  // colour wheels (lift / gamma / gain)
  const ch = [r, g, b].map((v, i) => {
    let x = clamp01(v);
    x = x + p.lift[i] * 0.25 * (1 - x);
    x = x * (1 + p.gain[i] * 0.5);
    x = Math.pow(clamp01(x), 1 / Math.max(0.2, 1 + p.gamma[i] * 0.6));
    return x;
  });
  [r, g, b] = ch;
  // contrast around mid grey
  if (p.contrast) {
    const k = 1 + p.contrast;
    r = (r - 0.5) * k + 0.5;
    g = (g - 0.5) * k + 0.5;
    b = (b - 0.5) * k + 0.5;
  }
  // tonal ranges weighted by luminance
  if (p.highlights || p.shadows || p.whites || p.blacks) {
    const L = clamp01(luma(r, g, b));
    const d = p.shadows * 0.3 * (1 - L) ** 2 + p.highlights * 0.3 * L ** 2 + p.blacks * 0.2 * (1 - L) ** 6 + p.whites * 0.2 * L ** 6;
    r += d;
    g += d;
    b += d;
  }
  r = clamp01(r);
  g = clamp01(g);
  b = clamp01(b);
  // curves: master then per channel
  if (curves) {
    const [cm, cr, cg, cb] = curves;
    r = clamp01(cr(cm(r)));
    g = clamp01(cg(cm(g)));
    b = clamp01(cb(cm(b)));
  }
  // saturation & vibrance
  if (p.saturation || p.vibrance) {
    const L = luma(r, g, b);
    const satNow = Math.max(r, g, b) - Math.min(r, g, b);
    const k = (1 + p.saturation) * (1 + p.vibrance * (1 - satNow));
    r = L + (r - L) * k;
    g = L + (g - L) * k;
    b = L + (b - L) * k;
  }
  // hue rotation (YIQ)
  if (p.hue) {
    const a = (p.hue * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const i = 0.596 * r - 0.274 * g - 0.322 * b;
    const q = 0.211 * r - 0.523 * g + 0.312 * b;
    const i2 = i * cos - q * sin;
    const q2 = i * sin + q * cos;
    r = y + 0.956 * i2 + 0.621 * q2;
    g = y - 0.272 * i2 - 0.647 * q2;
    b = y - 1.106 * i2 + 1.703 * q2;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** Bake the whole grade (+ optional imported LUT) into a 3D LUT. */
export function buildLut(p: ColorParams, userLut?: Lut3D | null, size = LUT_SIZE): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  const curves = [curveFn(p.curves.master), curveFn(p.curves.r), curveFn(p.curves.g), curveFn(p.curves.b)];
  const k = clamp01(p.lutIntensity);
  let o = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        let px = gradePixel(p, [ri / (size - 1), gi / (size - 1), bi / (size - 1)], curves);
        if (userLut && k > 0) {
          const u = sampleLut(userLut, px[0], px[1], px[2]);
          px = [px[0] + (u[0] - px[0]) * k, px[1] + (u[1] - px[1]) * k, px[2] + (u[2] - px[2]) * k];
        }
        data[o++] = px[0];
        data[o++] = px[1];
        data[o++] = px[2];
      }
  return { size, data };
}

// ------------------------------------------------------------------ .cube I/O

export function parseCube(text: string): Lut3D {
  let size = 0;
  const vals: number[] = [];
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === "LUT_3D_SIZE") size = parseInt(parts[1], 10);
    else if (key === "DOMAIN_MIN") domainMin = parts.slice(1, 4).map(Number);
    else if (key === "DOMAIN_MAX") domainMax = parts.slice(1, 4).map(Number);
    else if (key === "LUT_1D_SIZE") throw new Error("1D LUTs are not supported — use a 3D .cube file.");
    else if (/^[-+0-9.]/.test(parts[0]) && parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (size < 2 || vals.length !== size * size * size * 3) throw new Error("Invalid or unsupported .cube LUT file.");
  const data = new Float32Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    const c = i % 3;
    data[i] = clamp01((vals[i] - domainMin[c]) / (domainMax[c] - domainMin[c] || 1));
  }
  return { size, data };
}

export function toCube(l: Lut3D, title = "StudioX grade"): string {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${l.size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let i = 0; i < l.data.length; i += 3) lines.push(`${l.data[i].toFixed(6)} ${l.data[i + 1].toFixed(6)} ${l.data[i + 2].toFixed(6)}`);
  return lines.join("\n") + "\n";
}

// ------------------------------------------------------------------ presets

export const COLOR_PRESETS: { id: string; name: string; params: Partial<ColorParams> }[] = [
  { id: "cinematic", name: "Cinematic teal & orange", params: { contrast: 0.15, saturation: -0.05, lift: [-0.15, 0.0, 0.25], gain: [0.12, 0.02, -0.12], blacks: -0.2 } },
  { id: "warm", name: "Warm", params: { temperature: 0.45, vibrance: 0.15 } },
  { id: "cool", name: "Cool", params: { temperature: -0.45, tint: -0.05 } },
  { id: "vintage", name: "Vintage", params: { contrast: -0.15, saturation: -0.3, temperature: 0.3, lift: [0.2, 0.15, 0.05], blacks: 0.25 } },
  { id: "bw", name: "Black & white", params: { saturation: -1, contrast: 0.15 } },
  { id: "sepia", name: "Sepia", params: { saturation: -1, temperature: 0.8, tint: 0.1 } },
  { id: "vivid", name: "Vivid", params: { saturation: 0.3, vibrance: 0.3, contrast: 0.1 } },
  { id: "faded", name: "Faded film", params: { contrast: -0.25, blacks: 0.35, saturation: -0.15 } },
  { id: "night", name: "Night", params: { exposure: -0.6, temperature: -0.6, saturation: -0.3 } },
];
