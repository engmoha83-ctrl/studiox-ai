# Open-source license register

Check this list before any commercial distribution.

| Component | Use | License | Notes |
|---|---|---|---|
| Tauri 2, wry, tao | desktop shell | MIT / Apache-2.0 | |
| tauri-plugin-dialog, tauri-plugin-opener | native dialogs / reveal | MIT / Apache-2.0 | |
| rusqlite + bundled SQLite | database | MIT / public domain | |
| serde, serde_json, thiserror, base64, sysinfo | Rust core | MIT / Apache-2.0 | |
| React, React DOM | UI | MIT | |
| Zustand | state | MIT | |
| immer | immutable history | MIT | |
| i18next, react-i18next | localisation | MIT | |
| react-resizable-panels | layout | MIT | |
| lucide-react | icons | ISC | |
| Tailwind CSS | styling (build time) | MIT | |
| Vite, TypeScript, Vitest | build/test tools | MIT / Apache-2.0 | not shipped |
| Fonts: Cairo, Tajawal, Amiri, Noto Naskh Arabic, Inter, Bebas Neue, Playfair Display (@fontsource) | bundled title fonts | **SIL OFL 1.1** | may be embedded and redistributed; fonts may not be sold on their own |
| ureq | model downloads, local Ollama calls | MIT / Apache-2.0 | |
| tract-onnx (Sonos) | pure-Rust ONNX inference for the face detector | MIT / Apache-2.0 | linked into the app |
| whisper.cpp (`whisper-cli`) | speech recognition, separate executable | MIT | bundled by CI |
| **FFmpeg / FFprobe** | decoding, analysis, rendering (separate executables, invoked as processes — not linked) | **LGPL-2.1+** (lgpl build, default) or **GPL-2.0+/GPL-3.0** (gpl build with x264/x265) | See below |

## FFmpeg

* `npm run fetch-ffmpeg` bundles the **LGPL** build (BtbN FFmpeg-Builds) by default. It contains VP9, AV1 (SVT-AV1, libaom), Opus, AAC and the hardware encoders (NVENC, Quick Sync, AMF, Media Foundation) but **not** libx264/libx265.
* `FFMPEG_VARIANT=gpl npm run fetch-ffmpeg` bundles x264/x265. Distributing it makes the FFmpeg binary subject to the GPL: ship its license text and offer the corresponding source code. Because StudioX only *executes* FFmpeg as a separate program, the StudioX code itself is generally considered an aggregate, not a derivative — get legal advice for a commercial release.
* Patent-encumbered codecs (H.264/H.265/AAC) may require licences in some jurisdictions when distributed commercially; hardware/OS encoders shift this to the platform vendor.

## AI models

| Model | Use | License | Distribution |
|---|---|---|---|
| YuNet face detector `face_detection_yunet_2023mar.onnx` (OpenCV Zoo, Shiqi Yu) | face detection for smart reframe and "follow a face" | **MIT** (`src-tauri/models/LICENSE-yunet.txt`) | embedded in the app binary (230 KB) |
| Whisper ggml models (whisper.cpp / OpenAI) | speech recognition | MIT | downloaded by the user from Hugging Face |
| Ollama models | optional assistant | per model card (chosen and installed by the user) | not distributed by StudioX |

Models with non-commercial or copyleft terms (e.g. MODNet CC BY-NC-SA, Robust Video Matting GPL-3.0) are deliberately **not** used.
