// Keyframe evaluation (preview) and FFmpeg expression generation (export).
import type { Easing, Keyframe, Keyframes, KfProp, MediaClip } from "../types/project";

export const KF_PROPS: KfProp[] = ["x", "y", "scale", "rotation", "opacity", "volume"];

export function ease(e: Easing, u: number): number {
  switch (e) {
    case "hold":
      return 0;
    case "ease-in":
      return u * u * u;
    case "ease-out":
      return 1 - Math.pow(1 - u, 3);
    case "ease-in-out":
      return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    default:
      return u;
  }
}

/** Value of a keyframed property at clip-local time t (falls back to `base`). */
export function evalKf(kfs: Keyframe[] | undefined, t: number, base: number): number {
  if (!kfs || !kfs.length) return base;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1e-9);
      return a.v + (b.v - a.v) * ease(a.ease, u);
    }
  }
  return last.v;
}

export const hasKf = (c: { keyframes?: Keyframes }, p?: KfProp) =>
  !!c.keyframes && (p ? (c.keyframes[p]?.length ?? 0) > 0 : Object.values(c.keyframes).some((k) => k && k.length > 0));

const n = (v: number) => {
  const s = v.toFixed(5);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

function easeExpr(e: Easing, u: string): string {
  switch (e) {
    case "hold":
      return "0";
    case "ease-in":
      return `pow(${u},3)`;
    case "ease-out":
      return `(1-pow(1-${u},3))`;
    case "ease-in-out":
      return `if(lt(${u},0.5),4*pow(${u},3),1-pow(-2*${u}+2,3)/2)`;
    default:
      return u;
  }
}

/** FFmpeg expression of a keyframed value, in terms of the time variable `tv` (clip-local seconds). */
export function kfExpr(kfs: Keyframe[] | undefined, base: number, tv: string): string {
  if (!kfs || !kfs.length) return n(base);
  let expr = n(kfs[kfs.length - 1].v);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    const u = `((${tv}-${n(a.t)})/${n(b.t - a.t || 1e-6)})`;
    expr = `if(lt(${tv},${n(b.t)}),${n(a.v)}+(${n(b.v - a.v)})*${easeExpr(a.ease, u)},${expr})`;
  }
  return `if(lt(${tv},${n(kfs[0].t)}),${n(kfs[0].v)},${expr})`;
}

/** Base (static) value of a property on a media clip. */
export function baseValue(c: MediaClip, p: KfProp): number {
  switch (p) {
    case "x":
      return c.transform.x;
    case "y":
      return c.transform.y;
    case "scale":
      return c.transform.scale;
    case "rotation":
      return c.transform.rotation;
    case "opacity":
      return c.opacity;
    case "volume":
      return c.volume;
  }
}

/** Insert or replace a keyframe at time t (sorted). */
export function setKeyframe(list: Keyframe[] | undefined, t: number, v: number, easeType: Easing = "ease-in-out"): Keyframe[] {
  const out = (list ?? []).filter((k) => Math.abs(k.t - t) > 1e-4);
  out.push({ t, v, ease: easeType });
  return out.sort((a, b) => a.t - b.t);
}
