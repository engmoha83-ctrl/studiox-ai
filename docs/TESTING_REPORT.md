# Testing report — session 1

Environment: Linux x64 container, 2 vCPU / 8 GB, Xvfb, WebKitGTK 2.52, FFmpeg 6.1.1, Rust 1.97, Node 22.

## 1. Unit tests — `npm test` (Vitest) — **15/15 pass**
Timeline engine: add, split continuity, overwrite (split-middle), trim limits, ripple delete, close gap, cross-track compatibility, locked tracks, speed, detach audio, paste, snapping, silence-range removal. Export graph: inputs/overlays/amix, dissolve overlap, atempo chains, Arabic direction detection, Arabic-Indic digits.

## 2. Real FFmpeg render tests — `npm run test:export` — **4/4 pass**
A 5-layer project (2 video clips incl. a 4:3 MOV at 2× speed with cross dissolve, rotated/cropped/flipped/semi-transparent image with slide-in, text layer, music with gain and fades) rendered to:
* MP4 H.264/AAC (duration 7.0 s ±0.1, pixel checks: video visible, letterboxing correct, dissolve mid-blend, text visible)
* WebM VP9/Opus, MOV ProRes 422 HQ + PCM with 9:16 letterboxed output, MP4 CBR 1.5 Mb/s (bitrate verified), H.265 (x265), AV1 (SVT-AV1)

## 2b. Milestone 4 render tests — `tests/e2e/m4.test.ts` — **6/6 pass**
Colour grade via shared LUT (B&W verified by pixel), chroma key (keyed area shows the layer below, foreground kept), position/scale/rotation keyframes (object moves left→right, grows and rotates — pixel-verified), opacity keyframes (fade-in verified), mask + vignette + blur/grain/sharpen/letterbox, audio volume keyframes + EQ + compressor + noise reduction + master limiter (loudness rises as keyed).
Unit tests now **22/22** (colour LUT, curves, .cube round-trip, keyframe interpolation/expressions, keyframes following split/trim).

## 2c. Milestone 5 tests (0.4.0)
* Unit (`tests/m5.test.ts`, 14 tests): Arabic normalisation, built-in parser for Arabic/English requests (incl. "احذف الصمت وحوّله لتيك توك"), false-positive guards (تحليل ≠ night, مصدر ≠ export), subtitle language/translation, titles, "professional" macro, LLM output validation (unknown ops dropped, values clamped), reframe size, dead-zone smoothing, cover scale + pan math (subject centred, no black bars, speed mapping), user-positioned clips skipped.
* Rust (`cargo test --lib`, `ffmpeg::focus_tests`): the motion/detail tracker follows a white box moving across a real encoded video.
* Real FFmpeg (`tests/e2e/m5.test.ts`): 16:9 → 9:16 reframe with 40 pan keyframes renders; the moving box stays in the centre of the exported frame at 1 s / 2 s / 3 s and the corners show picture (no bars).
* Whole suite now: **40/40 unit**, **12/12 FFmpeg render** (+1 whisper test that runs in CI), **1/1 Rust**.

## 2d. Milestone 6 part 1 tests (0.5.0)
* Rust: YuNet on the standard OpenCV sample portrait gives the same box as OpenCV `FaceDetectorYN` (±6 px); a face moving across a 1280×720 video is found in all 8 sampled frames within 30 px of its true position; a flat image has no faces. (The test portrait is not committed; tests skip without it — set `STUDIOX_FACE_FIXTURE`.)
* Unit: main-person tracking ignores a passer-by, holds through missed frames, switches to a dominant new face; keyframe simplification; overlay offset/scale follow maths.
* Real FFmpeg: a red sticker following a swinging "face" with 17+ keyframes sits on the face at 4 sampled times — this test exposed a one-frame lead in exported keyframe animation (fixed).
* App E2E **48/48**: sticker follows a real detected face at ≈300 px/s on the canvas; smart reframe reports "1 clip framed on a detected face" and pans with it.

## 3. Application E2E — `tests/app/e2e_app.py` (real Tauri app via tauri-driver) — **46/46 pass** in 0.4.0 (table below lists the original 30; later additions: template/transition drag, keyframes, colour preset, preview quality, seek bar, 4× playback, SRT import, AI status, assistant Arabic request → plan → apply → undo per step, Ollama request path via a stand-in server)

| # | Check | Result |
|---|---|---|
| 1 | App boots, home screen | PASS |
| 2 | New project dialog → editor | PASS |
| 3 | 6 files imported with metadata (mp4, mp4, ProRes mov, wav, mp3, png) | PASS |
| 4 | Thumbnails for every asset | PASS |
| 5–6 | ProRes flagged → H.264 proxy generated in background | PASS |
| 7 | Duplicate import detected | PASS |
| 8–10 | Double-click adds clips; placement after the first clip | PASS |
| 11–13 | Split (S), undo (Ctrl+Z), redo (Ctrl+Y) | PASS |
| 14 | Ripple delete (Shift+Del) closes gap | PASS |
| 15 | Mouse drag moves a clip by 2 s | PASS |
| 16 | Mouse trim of a clip edge | PASS |
| 17–18 | Arabic title template + editing text in inspector | PASS |
| 19 | Cross dissolve applied from the Transitions panel | PASS |
| 20–21 | Image auto-placed on V2, music on A1 | PASS |
| 22 | Inspector transform edits (x, y, scale) | PASS |
| 23 | Preview canvas shows decoded video pixels | PASS |
| 24 | Playback advances playhead (~2.9 s in 2.5 s wall) | PASS |
| 25–27 | Export via dialog: job done, duration 20.03 s = timeline, H.264 + AAC | PASS |
| 28 | Project reopens with complete timeline | PASS |
| 29 | Moved media file → "Missing media" relink dialog | PASS |
| 30 | Arabic UI switches document to RTL | PASS |

Visual verification (screenshots reviewed): Arabic text "مرحبا بالعالم – Hello ٢٠٢٦" is correctly joined and ordered (RTL with embedded LTR) **in the preview and in frames extracted from the exported MP4**; full Arabic UI is mirrored while the timeline keeps LTR time flow.

## Bugs found and fixed during testing
* 0.4.0: **keyboard shortcuts stopped working while the export queue panel was open** (it was counted as a modal dialog) — found by the assistant undo test; fixed.
* WebKitGTK cannot play `<video>` from custom URI schemes → added the token-protected loopback HTTP media server with Range support (also benefits WebView2/WKWebView).
* Asset-protocol scope rejected dot-directories (`~/.cache`) → scope set with `requireLiteralLeadingDot: false`; thumbnails now via media server.
* Tailwind utility clash `bg-clip-text` made text clips invisible on the timeline → colours renamed.
* Native `<select>` unreadable on dark theme → `color-scheme: dark` + custom select styling.
* Export folder empty when the OS has no Videos folder → fallback chain (last used → Videos → Documents → Home).

## Not tested in this session
Ollama with a real language model (only a stand-in server), automatic subtitles inside the assistant flow in the app (whisper is tested on its own in CI), Windows/macOS runtime, hardware encoders on a real GPU, `.sxproj` import/export round-trip in the UI, version restore in the UI, very long (hour-plus) media, 4K/8K performance.
