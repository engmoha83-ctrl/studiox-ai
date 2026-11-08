import { describe, expect, it } from "vitest";
import { produce } from "immer";
import * as ops from "../src/engine/timelineOps";
import { isMediaClip, type MediaClip } from "../src/types/project";
import { makeMediaClip, makeTextClip, setup } from "./helpers";

const clipsOn = (p: any, track: string) => ops.clipsOnTrack(p, track) as MediaClip[];

describe("timeline operations", () => {
  it("adds a media clip with source duration", () => {
    const { p, v1 } = setup();
    const c = makeMediaClip(p.media[0], v1, 0, 30);
    const q = produce(p, (d) => ops.addClip(d, c));
    expect(q.clips[c.id].duration).toBeCloseTo(20);
    expect(ops.projectDuration(q)).toBeCloseTo(20);
  });

  it("splits a clip and keeps source continuity", () => {
    const { p, v1 } = setup();
    const c = makeMediaClip(p.media[0], v1, 2, 30);
    let q = produce(p, (d) => ops.addClip(d, c));
    let rightId: string | null = null;
    q = produce(q, (d) => { rightId = ops.splitClip(d, c.id, 7); });
    const left = q.clips[c.id] as MediaClip;
    const right = q.clips[rightId!] as MediaClip;
    expect(left.duration).toBeCloseTo(5);
    expect(right.start).toBeCloseTo(7);
    expect(right.in).toBeCloseTo(5);
    expect(right.duration).toBeCloseTo(15);
  });

  it("overwrites clips when dropping on top (split middle)", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30); // 0..20
    let q = produce(p, (d) => ops.addClip(d, a));
    const b = makeMediaClip(p.media[1], v1, 5, 30); // image 5..10
    q = produce(q, (d) => ops.addClip(d, b));
    const list = clipsOn(q, v1);
    expect(list.map((c) => [c.start, c.duration].map((x) => +x.toFixed(3)))).toEqual([[0, 5], [5, 5], [10, 10]]);
    expect(list[2].in).toBeCloseTo(10);
  });

  it("trims with source constraints", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 3, 30);
    let q = produce(p, (d) => ops.addClip(d, a));
    q = produce(q, (d) => ops.trimClip(d, a.id, "end", 100)); // cannot exceed source
    expect(q.clips[a.id].duration).toBeCloseTo(20);
    q = produce(q, (d) => ops.trimClip(d, a.id, "start", 5));
    expect(q.clips[a.id].start).toBeCloseTo(5);
    expect((q.clips[a.id] as MediaClip).in).toBeCloseTo(2);
    q = produce(q, (d) => ops.trimClip(d, a.id, "start", 0)); // can only extend back to in=0
    expect(q.clips[a.id].start).toBeCloseTo(3);
    expect((q.clips[a.id] as MediaClip).in).toBeCloseTo(0);
  });

  it("ripple deletes and closes gaps", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[1], v1, 0, 30);
    const b = makeMediaClip(p.media[1], v1, 5, 30);
    const c = makeMediaClip(p.media[1], v1, 10, 30);
    let q = produce(p, (d) => { ops.addClip(d, a); ops.addClip(d, b); ops.addClip(d, c); });
    q = produce(q, (d) => ops.deleteClips(d, [b.id], true));
    expect(q.clips[c.id].start).toBeCloseTo(5);
    q = produce(q, (d) => { d.clips[c.id].start = 8; });
    q = produce(q, (d) => { ops.closeGapAt(d, v1, 6); });
    expect(q.clips[c.id].start).toBeCloseTo(5);
  });

  it("moves clips across compatible tracks only", () => {
    const { p, v1, v2, a1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30);
    let q = produce(p, (d) => ops.addClip(d, a));
    q = produce(q, (d) => ops.moveClips(d, [{ id: a.id, start: 2, trackId: v2 }]));
    expect(q.clips[a.id].trackId).toBe(v2);
    const audio = makeMediaClip(p.media[2], a1, 0, 30);
    q = produce(q, (d) => ops.addClip(d, audio));
    q = produce(q, (d) => ops.moveClips(d, [{ id: audio.id, start: 0, trackId: v1 }]));
    expect(q.clips[audio.id].trackId).toBe(a1); // audio cannot go on a video track
  });

  it("respects locked tracks", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30);
    let q = produce(p, (d) => ops.addClip(d, a));
    q = produce(q, (d) => { d.tracks.find((t) => t.id === v1)!.locked = true; });
    q = produce(q, (d) => { ops.splitAt(d, 5); ops.deleteClips(d, [a.id]); });
    expect(Object.keys(q.clips)).toHaveLength(1);
  });

  it("changes speed and duration", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30);
    let q = produce(p, (d) => ops.addClip(d, a));
    q = produce(q, (d) => ops.setClipSpeed(d, a.id, 2));
    expect(q.clips[a.id].duration).toBeCloseTo(10);
  });

  it("detaches audio", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30);
    let q = produce(p, (d) => ops.addClip(d, a));
    let id: string | null = null;
    q = produce(q, (d) => { id = ops.detachAudio(d, a.id); });
    const det = q.clips[id!];
    expect(isMediaClip(det) && q.tracks.find((t) => t.id === det.trackId)!.kind).toBe("audio");
    expect((q.clips[a.id] as MediaClip).muted).toBe(true);
  });

  it("pastes clips at the playhead", () => {
    const { p, t1 } = setup();
    const t = makeTextClip(t1, 1, "مرحبا Hello");
    let q = produce(p, (d) => ops.addClip(d, t));
    let ids: string[] = [];
    q = produce(q, (d) => { ids = ops.pasteClips(d, [t], 10); });
    expect(q.clips[ids[0]].start).toBeCloseTo(10);
  });

  it("snaps to nearest edge", () => {
    const r = ops.snapTime(4.93, [0, 2], [5, 7.1], 0.15);
    expect(r.snapped).toBe(true);
    expect(r.time).toBeCloseTo(5);
  });
});

describe("removeRanges (silence removal)", () => {
  it("cuts ranges and ripples later clips", () => {
    const { p, v1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30); // 0..20
    let q = produce(p, (d) => ops.addClip(d, a));
    const b = makeMediaClip(p.media[1], v1, 25, 30); // image 25..30
    q = produce(q, (d) => ops.addClip(d, b));
    let removed = 0;
    q = produce(q, (d) => { removed = ops.removeRanges(d, a.id, [{ start: 2, end: 4 }, { start: 10, end: 11 }, { start: 0, end: 1 }]); });
    expect(removed).toBeCloseTo(4);
    const list = clipsOn(q, v1);
    expect(list.map((c) => +c.start.toFixed(3))).toEqual([0, 1, 7, 21]);
    expect(list.map((c) => +c.in.toFixed(3)).slice(0, 3)).toEqual([1, 4, 11]);
    expect(ops.clipEnd(list[2])).toBeCloseTo(16);
  });
});
