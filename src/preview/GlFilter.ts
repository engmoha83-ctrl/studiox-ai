// WebGL2 per-layer processor for the preview: crop + sharpen + 3D LUT (colour grade) + chroma key.
// The LUT is the very same one written to the .cube file for FFmpeg's lut3d at export time.
import type { Lut3D } from "../engine/color";

const VS = `#version 300 es
in vec2 p; out vec2 v; uniform vec4 crop;
void main(){ v = crop.xy + (p*0.5+0.5)*crop.zw; gl_Position = vec4(p.x, -p.y, 0., 1.); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 v; out vec4 o;
uniform sampler2D src; uniform sampler3D lut; uniform int useLut;
uniform int useKey; uniform vec2 keyUV; uniform float sim; uniform float blend;
uniform float sharpen; uniform vec2 texel;
void main(){
  vec4 c = texture(src, v);
  if (sharpen > 0.0) {
    vec3 b = (texture(src, v + vec2(texel.x, 0.)).rgb + texture(src, v - vec2(texel.x, 0.)).rgb +
              texture(src, v + vec2(0., texel.y)).rgb + texture(src, v - vec2(0., texel.y)).rgb) * 0.25;
    c.rgb = clamp(c.rgb + (c.rgb - b) * sharpen, 0., 1.);
  }
  if (useLut == 1) {
    float n = float(textureSize(lut, 0).x);
    c.rgb = texture(lut, c.rgb * (n - 1.) / n + 0.5 / n).rgb;
  }
  float a = 1.0;
  if (useKey == 1) {
    float u = -0.169 * c.r - 0.331 * c.g + 0.5 * c.b;
    float w = 0.5 * c.r - 0.419 * c.g - 0.081 * c.b;
    float d = length(vec2(u, w) - keyUV) / 1.41421356;
    a = blend > 0.0001 ? clamp((d - sim) / blend, 0., 1.) : (d > sim ? 1. : 0.);
  }
  o = vec4(c.rgb * a, a);
}`;

export interface GlParams {
  lut?: { key: string; lut: Lut3D } | null;
  key?: { color: string; similarity: number; blend: number } | null;
  sharpen?: number;
}

export class GlFilter {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private srcTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  private lutKey = "";
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor() {
    this.gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!this.gl) return;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    try {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      this.prog = p;
    } catch (e) {
      console.warn("GlFilter disabled:", e);
      this.gl = null;
      return;
    }
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(this.prog!, "p");
    gl.enableVertexAttribArray(pl);
    gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["src", "lut", "useLut", "useKey", "keyUV", "sim", "blend", "sharpen", "texel", "crop"]) this.loc[n] = gl.getUniformLocation(this.prog!, n);
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.lutTex = gl.createTexture();
  }

  get available() {
    return !!this.gl;
  }

  private uploadLut(l: Lut3D) {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, l.size, l.size, l.size, 0, gl.RGB, gl.FLOAT, l.data);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Process a crop of `src` (in source pixels) into a w×h premultiplied image. Returns null if WebGL2 is unavailable. */
  process(src: TexImageSource, srcW: number, srcH: number, crop: { x: number; y: number; w: number; h: number }, w: number, h: number, p: GlParams): HTMLCanvasElement | null {
    const gl = this.gl;
    if (!gl || !this.prog) return null;
    w = Math.max(1, Math.min(4096, Math.round(w)));
    h = Math.max(1, Math.min(4096, Math.round(h)));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      return null; // e.g. tainted / not ready
    }
    gl.uniform1i(this.loc.src, 0);
    gl.uniform1i(this.loc.lut, 1);
    gl.uniform4f(this.loc.crop, crop.x / srcW, crop.y / srcH, crop.w / srcW, crop.h / srcH);
    gl.uniform2f(this.loc.texel, 1 / srcW, 1 / srcH);
    gl.uniform1f(this.loc.sharpen, p.sharpen ?? 0);
    if (p.lut) {
      if (p.lut.key !== this.lutKey) {
        this.uploadLut(p.lut.lut);
        this.lutKey = p.lut.key;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.loc.useLut, 1);
    } else gl.uniform1i(this.loc.useLut, 0);
    if (p.key) {
      const n = parseInt(p.key.color.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      gl.uniform2f(this.loc.keyUV, -0.169 * r - 0.331 * g + 0.5 * b, 0.5 * r - 0.419 * g - 0.081 * b);
      gl.uniform1f(this.loc.sim, p.key.similarity);
      gl.uniform1f(this.loc.blend, p.key.blend);
      gl.uniform1i(this.loc.useKey, 1);
    } else gl.uniform1i(this.loc.useKey, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
