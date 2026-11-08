# StudioX project file format (`.sxproj`, version 1)

A project is a single UTF-8 JSON document. Media is **referenced by absolute path and never embedded**. The same document is stored in SQLite (`projects.data`) and written verbatim by *Export project file…*.

```jsonc
{
  "format": "studiox-project",        // required magic
  "version": 1,                        // format version (newer versions are refused, older are migrated)
  "id": "prj_…", "name": "My video", "createdAt": 1762600000000,
  "settings": { "width": 1920, "height": 1080, "fps": 30, "background": "#000000", "sampleRate": 48000 },
  "media": [ MediaAsset… ],
  "mediaFolders": [ { "id": "fld_…", "name": "B-roll" } ],
  "tracks": [ Track… ],                // index 0 = top layer
  "clips": { "<clipId>": Clip… },
  "markers": [ { "id": "…", "time": 12.5, "label": "", "color": "#f59e0b" } ]
}
```

### MediaAsset
| field | type | notes |
|---|---|---|
| `id`, `path`, `name` | string | `path` is absolute |
| `kind` | `"video" \| "audio" \| "image"` | |
| `duration` | number (s) | 0 for images |
| `width`, `height`, `fps` | number | display size (rotation applied) |
| `videoCodec`, `audioCodec`, `formatName` | string \| null | from FFprobe |
| `hasVideo`, `hasAudio` | boolean | |
| `size`, `mtime` | number | used for duplicate detection / cache keys |
| `addedAt`, `lastUsedAt` | ms epoch | |
| `folderId`, `favorite` | | library organisation |
| `thumbnail`, `proxyPath`, `proxyState` | optional | regenerable caches; safe to delete |

### Track
`{ id, kind: "video"|"audio"|"text", name, locked, hidden, muted, volume }` — `volume` is linear gain (1 = 100 %).

### Clip (common)
`{ id, trackId, start, duration, name?, transitionIn?, transitionOut? }` — times in seconds on the timeline, quantised to the project frame rate. `transition = { type: "fade"|"dissolve"|"slide-left"|"slide-right"|"slide-up"|"slide-down", duration }`.

### MediaClip (`"type": "media"`)
`mediaId`, `in` (source in-point, s), `speed` (0.1–16), `volume` (0–2), `muted`, `opacity` (0–1),
`transform { x, y (px offset from centre in project pixels), scale (1 = fit), rotation (deg), flipH, flipV }`,
`crop { left, top, right, bottom }` (fractions of the source), `audioFadeIn`, `audioFadeOut` (s).
Source range used: `[in, in + duration × speed]`.

### TextClip (`"type": "text"`)
`text`, `opacity`, `animIn`/`animOut` (`none|fade|slide-up|slide-down`), `animDuration`,
`style { fontFamily, fontSize (project px), fontWeight, italic, color, align (start|center|end), lineHeight, letterSpacing, outlineColor, outlineWidth, shadowColor, shadowBlur, shadowOffsetX, shadowOffsetY, backgroundColor, backgroundOpacity, backgroundPadding, backgroundRadius, x, y (centre, 0–1 of canvas), maxWidth (0–1), direction (auto|rtl|ltr), arabicDigits }`.

### Rules
* A track never contains overlapping clips (overwrite semantics).
* Hidden tracks are not rendered; muted tracks are silent; locked tracks reject edits.
* `dissolve`/`slide-*` transitions on a clip's start overlap the previous adjacent clip on the same track (the previous clip is extended by the transition duration using its source frames).
