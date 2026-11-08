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
| | Keyframes | ❌ (M4) |
| Clip ops (§5) | Crop, rotate, flip, scale, position, opacity, PiP | ✅ |
| | Speed (0.1–16×, pitch preserved) | ✅ |
| | Reverse, freeze frame, anchor point, masking, chroma key | ❌ (M4) |
| Transitions (§6) | Fade, dissolve, slide ×4 | ✅ |
| | Wipe, zoom, blur, spin, glitch, light | ❌ |
| Effects (§6) | Effects engine & library | ❌ (M4) |
| Audio (§7) | Volume, fades, mute, detach, waveform | ✅ |
| | EQ, compressor, limiter, reverb, noise reduction, ducking, beat detection, recording | ❌ |
| Text (§8) | Titles, lower thirds, templates, outline, shadow, background | ✅ |
| | Arabic shaping, RTL, mixed text, Arabic-Indic digits, Arabic fonts, correct in export | ✅ (verified in rendered file) |
| | Fade / slide animations | ✅ |
| | Word-level / karaoke, gradients, custom font import | ❌ |
| | SRT / VTT, automatic captions, translation | ❌ (M5) |
| Colour (§9) | All colour tools, LUTs | ❌ (M4) |
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
| | Whisper transcription, Ollama assistant, model manager, reframing, face/subject tracking, background removal, rough cuts | ❌ (M5/M6) |
| Advanced (§12) | Smart timeline inspector, brand kit, templates, custom shortcuts, plugins | ❌ |
