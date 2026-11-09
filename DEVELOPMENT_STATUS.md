# STUDIOX AI — Development Status

_Last updated: session 1 (2026-11-08) — patch 0.1.1 after first Windows test_

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
| M4 Professional editing | ⏳ Partial | Proxy workflow ✅. Keyframes, effects, colour, LUT, chroma key, masking, audio mixer: not started. |
| M5 Local AI | ⏳ Partial | Local silence detection (+ approved removal) ✅, scene-change detection (+ approved split) ✅. Whisper transcription, subtitles, reframing, assistant, model manager: not started. |
| M6 Advanced AI | ❌ Not started | |
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
- [x] Application E2E test (tauri-driver/WebDriver): 34/34 checks (incl. drag & drop of templates and transitions)

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

1. Run the CI workflow, install the NSIS build on Windows 10/11, run through `docs/USER_GUIDE.md` manually and fix WebView2-specific issues.
2. M4: keyframe model (`clip.keyframes[property] = [{t, v, easing}]`) → evaluate in `segments.evalLayer` and emit FFmpeg `sendcmd`/expression curves in `exportGraph`.
3. M4: colour correction via a shared parameter set → preview: WebGL shader pass; export: `eq`, `colorbalance`, `curves`, `lut3d` (LUT import).
4. M4: chroma key (`chromakey`/`colorkey` + shader), masks, audio mixer (EQ/compressor/limiter via `equalizer`, `acompressor`, `alimiter`), WebCodecs decoder.
5. M5: whisper.cpp sidecar + model manager (download with progress, size, CPU/GPU check) → subtitles (SRT/VTT import/export, Arabic timing) → AI assistant via Ollama with the existing approval workflow.

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
