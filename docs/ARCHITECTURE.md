# STUDIOX AI — Technical Architecture

> Source of requirements: *MASTER DEVELOPMENT PROMPT — Free-First Alternative to CapCut* (sections 1–18).
> Primary platform: **Windows 10/11 x64**. Future: macOS. UI languages: **English / العربية** with full LTR/RTL switching.

---

## 0. Development environment inspection (session 1)

| Tool | Version found | Notes |
|---|---|---|
| Node.js / npm | 22.23 / 10.9 | frontend toolchain |
| Rust / Cargo | 1.97 | Tauri backend |
| FFmpeg / FFprobe | 6.1.1 (Ubuntu build, GPL) | libx264, libx265, libvpx-vp9, libsvtav1, libaom, prores_ks, libopus, aac available → used for real export tests |
| WebKitGTK 4.1 | 2.52 (installed) | lets the real Tauri app be compiled and run under Xvfb on Linux for testing |
| Host OS | Linux x64 (cloud container) | **Cannot produce a Windows `.exe`/`.msi` locally** → Windows installer is produced by GitHub Actions (`.github/workflows/build.yml`) on `windows-latest`. |

Key library versions: Tauri 2.x, React 19, TypeScript 7, Vite 8, Tailwind 4, Zustand 5, immer 11, i18next, react-resizable-panels 4, rusqlite (bundled SQLite), sysinfo.

---

## 1. Module boundaries (Architecture rule: separate modules)

```
┌──────────────────────────── Tauri 2 window (WebView2 on Windows) ──────────────────────────┐
│ UI layer (src/components, src/i18n)        React + Tailwind, i18next, RTL/LTR              │
│        │ reads/dispatches                                                                  │
│ State layer (src/store)                    Zustand: project, history(commands), ui, app     │
│        │ calls pure functions                                                              │
│ Editing engine (src/engine)                PURE TypeScript, no DOM, unit tested             │
│   timelineOps · segments(render resolver) · transitions · exportGraph · presets · srt      │
│ Rendering (src/preview, src/engine/textRender.ts)                                          │
│   PreviewEngine: master clock → Canvas compositor → decoders(pool) · WebAudio-free sync     │
│ AI layer (src/ai)                          AIProviderManager → local / optional cloud      │
│        │ invoke() / events  (src/backend/api.ts = the only bridge)                          │
└────────┼───────────────────────────────────────────────────────────────────────────────────┘
┌────────┴──────────── Rust core (src-tauri/src) ────────────────────────────────────────────┐
│ media/ffmpeg.rs   locate binaries · probe · thumbnails · filmstrips · waveform peaks        │
│                   · proxy transcode · export runner (progress, ETA, cancel, .part files)    │
│                   · silence & scene detection (FFmpeg silencedetect / scdet)               │
│ project/db.rs     SQLite: projects, folders, archive, backups/versions, settings, assets   │
│ system.rs         OS/CPU/RAM/GPU/disk detection → performance profile                      │
│ files.rs          cache/temp dirs, existence checks (missing media), relink search         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
          │ spawns (no console window on Windows)
          ▼
   ffmpeg / ffprobe  (bundled in resources/binaries → user setting → PATH)
```

## 2. Key technical decisions

| Topic | Decision | Reason |
|---|---|---|
| Time model | seconds (`number`) **quantised to the project frame grid** on every edit | frame-accurate editing, trivial mapping to FFmpeg timestamps |
| Source of truth | one JSON `Project` document (format documented in `docs/PROJECT_FORMAT.md`) | the same data drives preview, export, save, undo |
| Undo / redo | command architecture: every edit is a named command producing a new immutable project (immer structural sharing); history keeps `{label, before, after}` | robust, cheap, every operation is undoable |
| Timeline engine | custom: tracks → clips; overwrite placement; ripple; snapping engine; pure functions in `engine/timelineOps.ts` | not dependent on any player |
| Preview | **custom compositor**: master clock → `resolveSegments(t)` → Canvas 2D drawing of every visible layer (video, image, text, transitions, opacity, transform, crop). Decoders: pooled `HTMLVideoElement`s used *only as frame sources* (WebView2 hardware decoding), driven by the clock | works on every WebView; **WebCodecs path (mp4 demux + `VideoDecoder`) is planned in Milestone 4** for faster frame-exact scrubbing on WebView2 |
| Unplayable codecs / large media | **automatic proxies** (H.264, 540p, GOP 12) generated in the background; export always uses originals | ProRes/DNxHD/HEVC-without-extension preview on Windows; fast scrubbing |
| Preview ≡ Export | `resolveSegments()` computes timing, source in-points, alpha, slide offsets for both; text uses the **same canvas renderer** for both | prevents "preview ≠ render" |
| Arabic text | text is shaped by the browser engine (HarfBuzz in Chromium/WebView2) on a canvas, saved as a transparent PNG and overlaid by FFmpeg | correct letter joining, RTL, mixed Arabic/English, Arabic-Indic digits, Arabic punctuation — identical in preview and export. Bundled OFL fonts: Cairo, Tajawal, Amiri, Noto Naskh Arabic |
| Export | FFmpeg filter graph generated in TS (`engine/exportGraph.ts`, unit-tested + integration-tested with real FFmpeg), executed in Rust with the graph in a script file (`-/filter_complex` ≥ v7, `-filter_complex_script` older), progress via `-progress pipe:1`, output written to `*.part` then renamed | no Windows command-line limit, real progress/ETA, cancel, no corrupt files after interruption |
| Hardware encoders | detected by **actually encoding a test frame** (NVENC, QuickSync, AMF, VideoToolbox) | "never claim support without checking" |
| Database | SQLite (rusqlite, bundled, WAL) in the app-data folder | projects, folders, archive, backups, version history, preferences, recent projects |
| Autosave / crash recovery | autosave 1.5 s after each edit; automatic backup every 5 min (last 30 kept); named versions on demand | nothing is lost on crash |
| i18n | i18next + react-i18next, `en` / `ar`, `dir` switched on `<html>`; layout uses logical CSS properties; **the timeline and preview stay LTR** (time flows left→right in every pro NLE) | full RTL UI without breaking editing ergonomics |
| AI | `AIProviderManager` with providers that declare `{id, local: boolean, capabilities}`; local first (FFmpeg analysis, whisper.cpp, Ollama), cloud providers disabled by default and require explicit consent per upload | free-first + privacy |

## 3. Folder structure

```
studiox-ai/
├─ docs/  ARCHITECTURE.md · PROJECT_FORMAT.md · USER_GUIDE.md · TESTING_REPORT.md
│         FEATURE_MATRIX.md · LICENSES.md
├─ DEVELOPMENT_STATUS.md          ← checklist, bugs, next tasks, continuation instructions
├─ README.md                      ← install / build guide
├─ src/
│  ├─ types/project.ts            ← data model
│  ├─ engine/                     ← pure editing engine (tested)
│  ├─ preview/                    ← compositor + decoder pool
│  ├─ ai/                         ← provider manager + providers
│  ├─ store/                      ← Zustand stores
│  ├─ backend/api.ts              ← typed Tauri bridge
│  ├─ i18n/{index.ts,en.json,ar.json}
│  └─ components/{home,editor,sidebar,preview,timeline,inspector,export,settings,common}
├─ src-tauri/src/{lib.rs,ffmpeg.rs,db.rs,system.rs,files.rs,error.rs}
├─ src-tauri/binaries/            ← ffmpeg.exe / ffprobe.exe bundled by CI
├─ tests/                         ← vitest unit tests
├─ scripts/e2e-export.mjs         ← real FFmpeg render test (incl. Arabic text)
└─ .github/workflows/build.yml    ← Windows installer (NSIS + MSI)
```

## 4. Data model (summary — full spec in PROJECT_FORMAT.md)

```ts
Project   { format:"studiox-project", version, id, name, settings{width,height,fps,background},
            media: MediaAsset[], mediaFolders: Folder[], tracks: Track[], clips: Record<id,Clip> }
MediaAsset{ id, path, name, kind:'video'|'audio'|'image', duration, width, height, fps,
            videoCodec, audioCodec, hasAudio, size, mtime, thumbnail?, proxyPath?, favorite, folderId }
Track     { id, kind:'video'|'audio'|'text', name, locked, hidden, muted, volume }   // index 0 = top layer
MediaClip { type:'media', id, trackId, mediaId, start, duration, in, speed, volume, muted,
            opacity, transform{x,y,scale,rotation,flipH,flipV}, crop{left,top,right,bottom},
            audioFadeIn, audioFadeOut, transitionIn?, transitionOut? }
TextClip  { type:'text', id, trackId, start, duration, text, style{…}, animIn, animOut }
```

## 5. Timeline engine architecture

* **Placement = overwrite**: dropping/moving a clip trims, splits or removes whatever it covers on the target track, so a track never contains overlaps.
* **Ripple delete** closes the gap on the same track; **ripple mode** toggle shifts later clips on move/trim.
* **Snapping** to clip edges on all tracks, playhead and 0, threshold in pixels (zoom independent).
* **Trim** is constrained by source media length (video/audio) and is free for images/text.
* **Split** at playhead affects selected clips (or all unlocked tracks under playhead if none selected).
* **Speed** changes duration (`duration = sourceLength / speed`).
* Locked tracks reject every operation; hidden tracks are skipped by preview and export; muted tracks are silent.

## 6. Technical risks

| Risk | Mitigation |
|---|---|
| WebView codec support differs (HEVC needs a Store extension on Windows, ProRes/DNxHD unsupported) | codec check at import → automatic proxy |
| `<video>` seeks to keyframes → slow scrubbing on long-GOP media | short-GOP proxies; WebCodecs decoder in Milestone 4 |
| Very large filter graphs (hundreds of clips) | Milestone 4: segment rendering + concat |
| FFmpeg licensing (GPL builds with x264/x265) | documented in `LICENSES.md`; for commercial distribution use an LGPL build + hardware encoders/OpenH264, or comply with GPL |
| Windows installer cannot be built in this Linux environment | GitHub Actions workflow builds NSIS `.exe` + `.msi` |
| Local AI models are large (Whisper base 142 MB … large-v3 3 GB) | model manager with explicit download, size display, CPU fallback, hardware-based model suggestion |

## 7. Milestone plan

M1 Desktop foundation → M2 Playback & timeline → M3 Basic editing & export → M4 Professional editing → M5 Local AI → M6 Advanced AI → M7 Commercial readiness. Status of each item is tracked in `DEVELOPMENT_STATUS.md` and `docs/FEATURE_MATRIX.md`.
