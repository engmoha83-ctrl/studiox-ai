# Feature completion matrix

✅ implemented & tested · 🟡 implemented, partially tested / limited · ❌ not implemented yet

| Area (prompt §) | Feature | Status |
|---|---|---|
| Platform (§2,3) | Installed desktop app (Tauri 2) | ✅ Linux run · 🟡 Windows via CI (unverified on hardware) |
| | Offline core editing | ✅ |
| | English / Arabic UI, RTL ↔ LTR switch | ✅ |
| Project mgmt (§10) | Create / open / save / autosave | ✅ |
| | Rename, duplicate, folders, archive, delete | ✅ (UI) |
| | Portable `.sxproj` export / import | 🟡 implemented, not E2E-tested |
| | Backups, named versions, restore | 🟡 implemented, not E2E-tested |
| | Missing-media detection / relink (file or folder search) | ✅ detection tested · 🟡 relink |
| Media library (§10) | Import video/audio/images (dialog, OS drag & drop) | ✅ |
| | Metadata, thumbnails, search, filters, favourites, recent | ✅ |
| | Duplicate detection | ✅ |
| Timeline (§5) | Multiple video/audio/text tracks, overlays | ✅ |
| | Drag & drop, move across tracks, snapping | ✅ |
| | Split, trim, delete, ripple delete, close gap | ✅ |
| | Ripple trim mode | ✅ (unit-tested) |
| | Rolling / slip / slide edits | ❌ |
| | Track lock / hide / mute | ✅ |
| | Grouping, nested sequences | ❌ |
| | Zoom, frame-accurate navigation, waveforms | ✅ |
| | Copy / paste / duplicate, multi-selection | ✅ |
| | Undo / redo | ✅ |
| | Keyframes (position, scale, rotation, opacity, volume; 5 easings) | ✅ |
| Clip ops (§5) | Crop, rotate, flip, scale, position, opacity, PiP | ✅ |
| | Speed (0.1–16×, pitch preserved) | ✅ |
| | Chroma key | ✅ |
| | Masks (rectangle / ellipse, feather, invert) | ✅ |
| | Reverse, freeze frame, anchor point | ❌ |
| Transitions (§6) | Fade, dissolve, slide ×4 | ✅ |
| | Wipe, zoom, blur, spin, glitch, light | ❌ |
| Effects (§6) | Blur, sharpen, vignette, film grain, cinematic bars (preview + export) | ✅ |
| | Glitch, light leaks, distortion, particles, saved effect chains | ❌ |
| Audio (§7) | Volume, fades, mute, detach, waveform | ✅ |
| | Track volume / mute / solo, master volume + limiter | ✅ |
| | EQ (3-band), compressor, noise reduction, volume automation (keyframes) | ✅ export · 🟡 not audible in preview |
| | Reverb, echo, ducking, beat detection, recording | ❌ |
| Text (§8) | Titles, lower thirds, templates, outline, shadow, background | ✅ |
| | Arabic shaping, RTL, mixed text, Arabic-Indic digits, Arabic fonts, correct in export | ✅ (verified in rendered file) |
| | Fade / slide animations | ✅ |
| | Word-level / karaoke, gradients, custom font import | ❌ |
| | SRT / VTT import + export, automatic captions (whisper.cpp, local), translate-to-English | ✅ (transcription verified in CI with real speech) |
| Colour (§9) | Exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, hue | ✅ |
| | Colour wheels (lift/gamma/gain), curves (RGB + R/G/B), presets, before/after | ✅ |
| | .cube LUT import + intensity | ✅ |
| | Scopes | ❌ |
| Export (§11) | MP4 / MOV / WebM | ✅ |
| | H.264, H.265, AV1, VP9, ProRes | ✅ (verified with real FFmpeg) |
| | 480p – 8K, 23.976 – 120 fps | ✅ |
| | CRF / VBR / CBR, audio codec settings | ✅ |
| | Hardware encoders (detected by test encode) | 🟡 detection implemented; no GPU in test env |
| | Background render, queue, batch, progress + ETA, cancel | ✅ |
| | Social presets (10) | ✅ |
| | Error recovery (`.part` files, temp clean-up at start) | ✅ |
| Performance (§14) | Hardware detection + 3 profiles | ✅ |
| | Proxies (auto for undecodable / > 1440p) | ✅ |
| | Background thumbnails / filmstrips / waveforms | ✅ |
| AI (§4) | Silence detection + approved removal (local) | ✅ |
| | Scene-change detection + approved split (local) | ✅ (UI path not E2E-tested) |
| | Local model manager (whisper.cpp models: download / cancel / delete, hardware recommendation) | ✅ |
| | Smart reframe 16:9 → 9:16 / 1:1 / 4:5 (and back) following motion + detail; user-positioned clips untouched | ✅ (tracker tested in Rust, render pixel-verified) |
| | AI editing assistant — Arabic/English built-in commands (offline), optional local Ollama model, plan → approve → one undo step per operation | ✅ (Ollama path tested against a stand-in server, not a real model) |
| | Face detection (local YuNet) → smart reframe follows people; overlays follow a face (position + optional scale) | ✅ (detector matches OpenCV; render pixel-verified; app E2E with a real face video) |
| | Smart scene selection, rough cuts, automatic editing, background removal, external AI providers | ❌ (M6, next) |
| Advanced (§12) | Smart timeline inspector, brand kit, templates, custom shortcuts, plugins | ❌ |
