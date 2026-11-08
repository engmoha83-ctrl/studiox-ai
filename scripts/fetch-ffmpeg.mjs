#!/usr/bin/env node
// Downloads FFmpeg + FFprobe into src-tauri/binaries so they are bundled with the installer.
//   FFMPEG_VARIANT=lgpl (default) | gpl      FFMPEG_URL=<zip url> (override)
// LGPL builds lack libx264/libx265; StudioX then uses hardware or Media Foundation H.264/H.265
// encoders and VP9/AV1. GPL builds add x264/x265 — see docs/LICENSES.md before distributing.
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "src-tauri", "binaries");
const tmp = join(root, ".ffmpeg-download");
const variant = process.env.FFMPEG_VARIANT || "lgpl";
const plat = process.platform;

const urls =
  process.env.FFMPEG_URL
    ? [process.env.FFMPEG_URL]
    : plat === "win32"
      ? [
          `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-${variant}-8.1.zip`,
          `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-${variant}.zip`,
        ]
      : plat === "linux"
        ? [`https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-${variant}-8.1.tar.xz`]
        : [];

if (!urls.length) {
  console.log("No automatic FFmpeg download for this platform. Install FFmpeg (e.g. `brew install ffmpeg`); StudioX finds it on the PATH.");
  process.exit(0);
}

async function download(url, file) {
  console.log("Downloading", url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

function findFile(dir, name) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e === name) return p;
  }
  return null;
}

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });
let ok = false;
for (const url of urls) {
  const archive = join(tmp, url.endsWith(".zip") ? "ff.zip" : "ff.tar.xz");
  try {
    await download(url, archive);
    if (archive.endsWith(".zip")) {
      if (plat === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force '${archive}' '${tmp}'`], { stdio: "inherit" });
      else execFileSync("unzip", ["-q", "-o", archive, "-d", tmp], { stdio: "inherit" });
    } else execFileSync("tar", ["-xJf", archive, "-C", tmp], { stdio: "inherit" });
    ok = true;
    break;
  } catch (e) {
    console.warn("  failed:", e.message);
  }
}
if (!ok) {
  console.error("Could not download FFmpeg.");
  process.exit(1);
}
const exe = plat === "win32" ? ".exe" : "";
for (const name of ["ffmpeg", "ffprobe"]) {
  const f = findFile(tmp, name + exe);
  if (!f) throw new Error(`${name}${exe} not found in archive`);
  renameSync(f, join(out, name + exe));
  console.log("  ->", join(out, name + exe));
}
rmSync(tmp, { recursive: true, force: true });
if (existsSync(join(out, "ffmpeg" + exe))) console.log(`FFmpeg (${variant}) ready in src-tauri/binaries`);
