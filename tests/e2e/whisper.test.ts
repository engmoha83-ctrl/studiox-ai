// Real local speech recognition (runs in CI where the model can be downloaded).
// Uses exactly the arguments of src-tauri/src/ai.rs and the app's JSON parser.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cuesFromWhisper, toSrt } from "../../src/engine/subtitles";

const CLI = process.env.WHISPER_CLI;
const MODEL = process.env.WHISPER_MODEL;
const run = CLI && MODEL ? describe : describe.skip;

run("whisper.cpp transcription", () => {
  it("transcribes synthetic English speech into timed cues", () => {
    const dir = mkdtempSync(join(tmpdir(), "sx-whisper-"));
    execFileSync("espeak-ng", ["-v", "en-us", "-s", "140", "-w", join(dir, "speech.wav"), "Hello world. This is a video editing test. Thank you for watching."]);
    // same extraction as ai.rs
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", join(dir, "speech.wav"), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", join(dir, "audio.wav")]);
    execFileSync(CLI!, ["-m", MODEL!, "-f", join(dir, "audio.wav"), "-l", "en", "-t", "4", "-oj", "-pp", "-ml", "42", "-sow", "-of", join(dir, "transcript")], { stdio: "inherit" });
    const { cues } = cuesFromWhisper(readFileSync(join(dir, "transcript.json"), "utf8"));
    console.log(toSrt(cues));
    const all = cues.map((c) => c.text).join(" ").toLowerCase();
    expect(all).toMatch(/hello/);
    expect(all).toMatch(/test/);
    expect(cues.length).toBeGreaterThan(1);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].start);
  }, 300000);
});
