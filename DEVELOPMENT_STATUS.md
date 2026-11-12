# STUDIOX AI — Development Status

_Last updated: 2026-11-12 — 0.5.0 (Milestone 6 part 1: face tracking)_

### 0.5.0 — Milestone 6 (part 1): subject tracking
* **Face detection** (`src-tauri/src/vision.rs`): YuNet (MIT, OpenCV Zoo, 230 KB) embedded in the binary and run with **tract** (pure-Rust ONNX inference — no runtime to install). Frames are letter-boxed into 640×640; decoding/NMS follow OpenCV's `FaceDetectorYN` and the boxes match OpenCV within a few pixels. ~50 ms per analysed frame in release builds (CPU, test machine).
* **Smart reframe now frames people:** if a face is visible in ≥ 30 % of a clip's frames, the camera follows the main person (`primaryFaceTrack`: sticks to one person, ignores passers-by, switches only when a clearly bigger face stays for 3 samples); otherwise motion/detail tracking as before.
* **Follow a face** (AI panel): a sticker / logo / picture-in-picture clip follows the main face in the video below it, keeping the offset the user gave it (e.g. above the head), optionally scaling with the face. Result = editable x/y(/scale) keyframes, simplified with Ramer–Douglas–Peucker (2 px tolerance).
* **Fix (export, since 0.2.0):** animated position/scale/rotation was one frame early in exported files — FFmpeg's `perspective` filter counts frames from 1. Found by the new follow-face render test (a fast-moving sticker was 20–25 px ahead); expressions now use `(in-1)/fps`.
* Analysis frames are sampled with `fps=…:round=up` so sample *i* is exactly at *i / rate* (the default rounding shifted samples by half an interval).

### 0.4.0 — Milestone 5 complete
* **Smart reframe** (`src/engine/reframe.ts`, `src/services/reframe.ts`, Rust `ffmpeg::analyze_focus`): every visual clip is decoded at 4 fps / 128×72 grey; motion (frame difference) + detail (gradient) give a weighted focus point per frame. Focus is held through flat frames, smoothed (weighted moving average) and passed through a dead-zone (8 % of the visible window) so the virtual camera doesn't shake. Result: project size changes (short side kept, e.g. 1920×1080 → 1080×1920), clips get a cover scale and x/y pan keyframes (≤ 40 per axis, linear through continuous pans, eased at starts/stops). Clips the user already positioned/scaled/rotated/animated are skipped. One undo step. Preview and export use the existing keyframe path (identical).
* **AI editing assistant** (`src/engine/assistantParse.ts`, `src/services/assistant.ts`, `AssistantAI.tsx`): request (Arabic/English) → plan of operations → user approves/unticks → execution, one undo step per operation. Operations: remove silence, split scenes, speed (selection), transitions at cuts, colour look, smart reframe, automatic subtitles, title, open export. Built-in parser works offline (Arabic spelling normalisation, keyword guards). Optional local Ollama model (`/api/chat`, `format: json`) — its output is validated against the same whitelist; on failure it falls back to the built-in parser and says so.
* Silence removal by the assistant works on the camera audio (and keeps a detached picture in sync); music files are left alone unless the project has no video with sound.
* Fix: keyboard shortcuts were ignored while the (non-modal) export queue panel was open.

### 0.3.1
* Fast clips (speed > 2.5× effective) stuttered/flashed "Loading…" in the preview: the decoder couldn't keep up and constant resync seeks blanked the frame. Now fast clips are stepped by seeking, the drift tolerance scales with speed, and the last decoded frame is kept on screen while a decoder seeks or buffers.
* CI: whisper.cpp download falls back to pinned releases when `latest` lacks the Windows asset.

### 0.3.0 — Milestone 5 (part 1)
* `src-tauri/src/ai.rs`: whisper.cpp runner (16 kHz extraction → `whisper-cli -oj -pp -ml -sow [-tr]`, progress events, cancel), model downloads (ureq, `.part` + rename, HTTPS from Hugging Face/GitHub only), Ollama detection/chat (for the assistant).
* whisper.cpp CLI for Windows is bundled by CI (`npm run fetch-whisper`); models are downloaded by the user.
* Real transcription is tested in CI (`ai` job: whisper.cpp + tiny model + espeak-ng speech) because model hosting is not reachable from the development sandbox.
* Many static text clips on one track (subtitles) are rendered through a single ffconcat input — verified with 40 cues (frame-accurate timing).

### 0.2.0 — Milestone 4
* Colour: every adjustment is baked into one 33³ 3D LUT (`src/engine/color.ts`) → WebGL2 3D texture in the preview and FFmpeg `lut3d` in the export (identical maths).
* Keyframes: preview evaluates curves; export uses `perspective` (corner mapping per frame) for animated geometry, `geq` for animated opacity and `volume=…:eval=frame` for volume.
* Masks & vignette are drawn by shared canvas code (`src/engine/layerFx.ts`) and composited with `blend`/`overlay` in the export.
* Known limitation: audio effects (EQ, compressor, noise reduction) are export-only — the preview plays without them.

### 0.1.3
* Window close button did nothing while a project was open: the close handler saves the project, then Tauri must destroy the window, which needed the `core:window:allow-destroy` permission. Fixed (save is capped at 3 s so closing never hangs).

### Windows feedback round 2 → 0.1.2
* Preview seek bar added (also in full-screen preview), with hover timecode.
* Import / export icons corrected (import = arrow into tray, export = arrow out).
* Full / Half / Quarter preview quality verified to change the render resolution; the selector now shows the actual size (e.g. "Half · 960×540") so the effect is visible.

### Windows feedback (0.1.0) and fixes in 0.1.1
* Import, export, rotate/scale/crop confirmed working on Windows by the user.
* **Text/transitions could not be dragged onto the timeline on Windows** — WebView2 swallows HTML5 drag events while OS file-drop is enabled. Replaced with a pointer-based in-app drag system (`src/editor/dragdrop.ts`); OS file drop still works.
* **Zoom-out could not show long videos** — minimum zoom lowered to 0.02 px/s, larger ruler steps, automatic zoom-to-fit when the first clips are added.
* **Export speed** — filter graph now uses every CPU core (`-filter_complex_threads`), video layers composite in YUV(A) 4:2:0 instead of RGBA, and layers without opacity/fades/rotation skip the alpha channel.


## Milestone status

| Milestone | Status | Acceptance criteria |
|---|---|---|
| **M1 Desktop foundation** | ✅ Complete (Linux-verified) · ⏳ Windows installer via CI | App builds and runs as a real Tauri desktop app; creates, saves and reopens projects (E2E-tested). The Windows `.exe`/`.msi` is produced by `.github/workflows/build.yml` — **not yet run on real Windows hardware.** |
| **M2 Video playback & timeline** | ✅ Complete | Real clips edited on multiple tracks: add, move, trim, split, delete, ripple delete, zoom, undo/redo, synced playback (E2E-tested). |
| **M3 Basic editing & export** | ✅ Complete | Crop/transform/speed/text/transitions/audio basics; real FFmpeg export with progress produces a playable file whose duration matches the timeline (E2E-tested incl. Arabic text in the rendered file). |
| **M4 Professional editing** | ✅ Complete (0.2.0) | Keyframes (position, scale, rotation, opacity, volume + 5 easings), colour correction (11 controls, colour wheels, curves, 9 presets, before/after), .cube LUT import with intensity, chroma key, masks (rectangle/ellipse, feather, invert), effects (blur, sharpen, vignette, film grain, cinematic bars), audio mixing (track volume/mute/solo, EQ, compressor, noise reduction, master volume + limiter), proxies. Verified by real-FFmpeg render tests and app E2E. |
| **M5 Local AI** | ✅ Complete (0.4.0) | Silence detection + removal, scene detection + split, **local model manager** (whisper.cpp models: download with progress / cancel / delete, hardware-based recommendation), **automatic subtitles** (whisper.cpp, Arabic/English/auto + translate-to-English, line length), SRT/VTT import & export, batched subtitle rendering, **smart reframe** (motion/detail tracking → cover + pan keyframes; no face recognition), **AI assistant** (Arabic/English built-in commands offline + optional local Ollama; approval before every change; one undo step per operation). Not verified: Ollama with a real model (tested against a stand-in server). |
| **M6 Advanced AI** | ⏳ In progress (0.5.0) | ✅ subject tracking (local face detection → reframe on people, overlays follow a face). ⏳ smart scene selection, AI rough cuts, automatic editing (styles, target duration), background removal, optional external AI providers. |
| M7 Commercial readiness | ⏳ Partial | App icon ✅, crash-safe autosave/backups ✅, automated tests ✅, docs ✅, installer config ✅ (CI). Code signing, profiling, security review: not started. |

## Implementation checklist (done)

- [x] Tauri 2 + React 19 + TS + Vite + Tailwind 4 + Zustand + i18next project
- [x] Rust core: FFmpeg discovery (bundled → settings → PATH), probe, thumbnails, filmstrips, waveform peaks, proxies, export runner (progress, ETA, cancel, `.part` files), silence & scene detection, hardware-encoder verification
- [x] Loopback media server with HTTP Range (reliable video decoding in every WebView)
- [x] SQLite: projects, folders, archive, backups/version history, settings, asset (probe) index
- [x] Hardware detection + Low / Balanced / High performance profile on first launch
- [x] Project data model + documented JSON format (`docs/PROJECT_FORMAT.md`)
- [x] Pure timeline engine (overwrite placement, split, trim, ripple, close gap, speed, detach audio, paste, snapping, range removal) — 15 unit tests
- [x] Shared render resolver (preview ≡ export), FFmpeg graph builder — real-FFmpeg integration tests (H.264, H.265, AV1, VP9, ProRes, CBR, letterbox)
- [x] Preview compositor (canvas, transform, crop, opacity, flip, rotate, transitions, text) with A/V sync, quality levels, safe areas, full screen, playback speed, on-canvas move
- [x] Timeline UI: multi-track, drag/move across tracks, trim handles, snapping indicator, zoom (ctrl+wheel/slider/fit), ruler scrubbing, filmstrips, waveforms, track lock/hide/mute, context menus, drop from library and OS
- [x] Media library: import (dialog + OS drag & drop), thumbnails, metadata, search, filters, folders, favourites, recently used, unused flag, duplicate detection, missing-media relink (file or folder search)
- [x] Text: 10 templates (incl. Arabic), 7 bundled OFL fonts + system fonts, outline, shadow, background box, alignment, RTL/LTR/auto, Arabic-Indic digits, fade/slide animations
- [x] Transitions: fade, cross dissolve, slide ×4 (in/out, drag onto clip edge)
- [x] Audio: volume (0–200 %), fades, clip/track mute, detach audio, waveform
- [x] Export: MP4/MOV/WebM, verified encoders only, 480p–8K, 23.976–120 fps, CRF/VBR/CBR, audio settings, 10 social presets, batch export, background queue
- [x] Undo/redo (300 steps, named commands, coalesced slider edits), autosave (1.5 s), automatic backups (5 min, 30 kept), named versions
- [x] English / Arabic UI with full RTL mirroring (timeline & preview stay LTR by design)
- [x] Keyboard shortcuts (23) + shortcut sheet
- [x] Application E2E test (tauri-driver/WebDriver): 40/40 checks (incl. drag & drop of templates and transitions)

## Known bugs / limitations

1. **Not yet run on Windows.** All runtime testing happened on Linux (WebKitGTK). Windows-specific code paths (WebView2 decoding, `CREATE_NO_WINDOW`, PowerShell GPU query, NSIS/MSI) are implemented but unverified until the CI build is installed on a Windows PC.
2. Preview decoders are `HTMLVideoElement`s driven by a master clock; scrubbing long-GOP originals can lag (proxies fix it). WebCodecs path not implemented yet.
3. Preview volume is capped at 100 % (export honours up to 200 %).
4. Text animations available: fade, slide up/down (pop & typewriter types exist in the model but are hidden).
5. Wipe / zoom / blur / spin / glitch / light transitions not implemented.
6. Reverse playback & freeze frame not implemented (field reserved in the model).
7. Custom keyboard shortcuts and custom font import are not implemented.
8. FFmpeg ≥ 7 uses `-/filter_complex <file>`; only FFmpeg 6.1 was available for testing here.
9. Very large timelines (hundreds of clips) produce one FFmpeg input per clip; segment rendering is planned.

## Next development tasks (in order)

1. M6 (in order): smart scene selection (quality/face/speech/duplicate scoring), AI rough cuts from transcripts, automatic editing (style + target duration + aspect → editable draft), background removal (licence-clean model), optional external AI providers (off by default).
2. Backlog from M5: preview audio for clips faster than 2.5×, subtitles from the assistant use the recommended model only (no model picker in the request).
3. Backlog from M4: more transitions (FFmpeg xfade family), text keyframes, audio-effects preview through WebAudio, WebCodecs decoder.

## Continuation instructions (next session)

```bash
cd studiox-ai
npm ci
npm test                 # unit tests
npm run test:export      # real FFmpeg render tests (needs ffmpeg on PATH)
npm run tauri dev        # run the app
# Application E2E (Linux): see tests/app/README.md
```
Read `docs/ARCHITECTURE.md` first; editing logic lives in `src/engine` (pure, tested), rendering in `src/preview`, persistence/FFmpeg in `src-tauri/src`.
