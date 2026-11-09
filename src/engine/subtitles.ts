// Subtitle cues: SRT / VTT / whisper.cpp JSON parsing & writing, and conversion to timeline text clips.
import { makeTextClip } from "./defaults";
import type { TextClip, TextStyle } from "../types/project";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ts = (s: string): number => {
  const m = s.trim().replace(",", ".").match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (!m) return NaN;
  return (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4].padEnd(3, "0") / 1000 : 0);
};

/** Parses SRT and WebVTT. */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, "").replace(/\r/g, "").split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, z] = lines[i].split("-->");
    const start = ts(a);
    const end = ts(z.trim().split(/\s+/)[0]);
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start && body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

const fmt = (t: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms % 1000, 3)}`;
};

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start, ",")} --> ${fmt(c.end, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map((c) => `${fmt(c.start, ".")} --> ${fmt(c.end, ".")}\n${c.text}\n`).join("\n");
}

/** whisper.cpp `-oj` output → cues (seconds relative to the transcribed range). */
export function cuesFromWhisper(json: string): { cues: Cue[]; language?: string } {
  const j = JSON.parse(json);
  const cues: Cue[] = (j.transcription ?? [])
    .map((s: { offsets: { from: number; to: number }; text: string }) => ({ start: s.offsets.from / 1000, end: s.offsets.to / 1000, text: String(s.text).trim() }))
    .filter((c: Cue) => c.text && !/^\[.*\]$/.test(c.text) && c.end > c.start);
  return { cues, language: j.result?.language };
}

const RTL = /[֐-ࣿ]/;

/** Subtitle look: bottom-centred box; Arabic font for Arabic text. */
export function subtitleStyle(sample: string, height: number): Partial<TextStyle> {
  const arabic = RTL.test(sample);
  return {
    fontFamily: arabic ? "Tajawal" : "Inter",
    fontWeight: 700,
    fontSize: Math.round(height * 0.05),
    y: 0.88,
    maxWidth: 0.86,
    backgroundOpacity: 0.55,
    backgroundPadding: 14,
    backgroundRadius: 8,
    shadowBlur: 0,
    shadowOffsetY: 0,
  };
}

/** Make timeline text clips for cues (times already in timeline seconds). */
export function cueClips(cues: Cue[], trackId: string, height: number, fps: number): TextClip[] {
  const style = subtitleStyle(cues.map((c) => c.text).join(" "), height);
  const snap = (t: number) => Math.round(t * fps) / fps;
  return cues.map((c) => {
    const clip = makeTextClip(trackId, snap(c.start), c.text, style, Math.max(1 / fps, snap(c.end) - snap(c.start)));
    clip.animIn = "none";
    clip.animOut = "none";
    clip.name = "subtitle";
    return clip;
  });
}

export function cuesFromClips(clips: TextClip[]): Cue[] {
  return clips
    .map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text }))
    .sort((a, b) => a.start - b.start);
}
