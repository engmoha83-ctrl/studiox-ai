import { describe, expect, it } from "vitest";
import { cuesFromWhisper, parseSubtitles, toSrt, toVtt, cueClips } from "../src/engine/subtitles";
import { concatList, isBatchableText } from "../src/engine/exportGraph";

const SRT = `1
00:00:01,000 --> 00:00:02,500
مرحبا بكم

2
00:00:03,000 --> 00:00:04,000
<i>Hello</i> world
`;

describe("subtitles", () => {
  it("parses SRT and VTT, round-trips", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toEqual([
      { start: 1, end: 2.5, text: "مرحبا بكم" },
      { start: 3, end: 4, text: "Hello world" },
    ]);
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
    expect(parseSubtitles(toVtt(cues))).toEqual(cues);
    expect(toVtt(cues).startsWith("WEBVTT")).toBe(true);
    expect(parseSubtitles("WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nhi\n")).toEqual([{ start: 1, end: 2, text: "hi" }]);
  });
  it("reads whisper.cpp JSON", () => {
    const j = JSON.stringify({ result: { language: "ar" }, transcription: [{ offsets: { from: 0, to: 1500 }, text: " السلام عليكم" }, { offsets: { from: 1500, to: 2000 }, text: " [Music]" }] });
    const r = cuesFromWhisper(j);
    expect(r.language).toBe("ar");
    expect(r.cues).toEqual([{ start: 0, end: 1.5, text: "السلام عليكم" }]);
  });
  it("makes static (batchable) subtitle clips with an Arabic font for Arabic", () => {
    const clips = cueClips([{ start: 1, end: 2, text: "مرحبا" }], "trk", 1080, 30);
    expect(clips[0].style.fontFamily).toBe("Tajawal");
    expect(isBatchableText(clips[0])).toBe(true);
  });
  it("builds an ffconcat list with gaps", () => {
    const l = concatList([{ start: 1, end: 2, png: "C:\\a\\b.png" }], "/tmp/blank.png");
    expect(l).toContain("file '/tmp/blank.png'\nduration 1\nfile 'C:/a/b.png'\nduration 1");
  });
});
