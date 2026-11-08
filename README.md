# STUDIOX AI

Free-first, local-first desktop video editor (Tauri 2 · Rust · React · FFmpeg) with Arabic & English UI.

> **الحالة:** المراحل 1–3 (الأساس، الخط الزمني والمعاينة، التحرير الأساسي والتصدير) مكتملة ومختبرة. التفاصيل في [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md).

## Get a Windows installer (easiest)

1. Push this folder to a GitHub repository.
2. Open **Actions → Build StudioX AI → Run workflow**.
3. Download the artifact **StudioX-AI-windows-x64** → run the `.exe` (NSIS) or `.msi` installer.
   FFmpeg (LGPL build) is bundled automatically.

## Build locally on Windows 10/11

Prerequisites: [Node.js 22](https://nodejs.org), [Rust](https://rustup.rs) (MSVC toolchain), Visual Studio Build Tools (“Desktop development with C++”), WebView2 runtime (preinstalled on Windows 11).

```powershell
npm ci
npm run fetch-ffmpeg          # downloads ffmpeg.exe + ffprobe.exe into src-tauri\binaries
npm run tauri dev             # run in development mode
npm run tauri build           # installer → src-tauri\target\release\bundle\nsis\ and \msi\
```

FFmpeg lookup order at runtime: bundled `binaries/` → folder chosen in **Settings** → system `PATH` (e.g. `winget install Gyan.FFmpeg`).

## macOS / Linux (development)

```bash
brew install ffmpeg            # macOS   |  sudo apt install ffmpeg libwebkit2gtk-4.1-dev ... (Linux)
npm ci && npm run tauri dev
```

## Tests

```bash
npm test               # engine unit tests
npm run test:export    # real FFmpeg rendering tests (H.264/H.265/AV1/VP9/ProRes)
# full application E2E: tests/app/README.md
```

## Documentation

| Document | Content |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | architecture, decisions, risks |
| [docs/PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md) | `.sxproj` JSON format |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | user guide (عربي / English) |
| [docs/FEATURE_MATRIX.md](docs/FEATURE_MATRIX.md) | what is done / not done |
| [docs/TESTING_REPORT.md](docs/TESTING_REPORT.md) | test results |
| [docs/LICENSES.md](docs/LICENSES.md) | open-source license register |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) | checklist, known issues, next steps |

## Free vs paid

Everything in this version is free and runs offline. No account, no telemetry, no paid API. Optional cloud AI providers (future) will be disabled by default and ask before uploading anything.
