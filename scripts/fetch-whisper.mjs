#!/usr/bin/env node
// Downloads the whisper.cpp CLI (MIT) into src-tauri/binaries/whisper for bundling (Windows x64).
import { execFileSync } from "node:child_process";
import { copyFileSync, createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "src-tauri", "binaries", "whisper");
const tmp = join(root, ".whisper-download");
if (process.platform !== "win32" && !process.env.WHISPER_URL) {
  console.log("Prebuilt whisper.cpp is fetched for Windows only. Elsewhere build it (cmake) or install it, then set its folder in Settings → AI models.");
  process.exit(0);
}
const urls = process.env.WHISPER_URL
  ? [process.env.WHISPER_URL]
  : ["latest/download", "download/v1.8.6", "download/v1.8.4", "download/v1.8.2"].map((r) => `https://github.com/ggml-org/whisper.cpp/releases/${r}/whisper-bin-x64.zip`);

async function download(u, file, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`Downloading (attempt ${i}/${attempts})`, u);
      const res = await fetch(u, { redirect: "follow" });
      if (res.status === 404) throw Object.assign(new Error("404 Not Found"), { notFound: true });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
      return;
    } catch (e) {
      if (e.notFound || i === attempts) throw e;
      await new Promise((r) => setTimeout(r, 15000 * i));
    }
  }
}
const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });
const zip = join(tmp, "whisper.zip");
let ok = false;
for (const url of urls) {
  try {
    await download(url, zip);
    ok = true;
    break;
  } catch (e) {
    console.warn("  not available:", url, e.message);
  }
}
if (!ok) throw new Error("Could not download whisper.cpp");
if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force '${zip}' '${tmp}'`], { stdio: "inherit" });
else execFileSync("unzip", ["-q", "-o", zip, "-d", tmp], { stdio: "inherit" });
const files = walk(tmp).filter((f) => /\.(exe|dll)$/i.test(f) || /whisper-cli$/.test(f));
if (!files.some((f) => /whisper-cli(\.exe)?$/i.test(f))) throw new Error("whisper-cli not found in the archive");
for (const f of files) {
  const name = f.split(/[\\/]/).pop();
  if (/^(whisper-cli|.*\.dll)$/i.test(name.replace(/\.exe$/i, "")) || /\.dll$/i.test(name)) {
    copyFileSync(f, join(out, name));
    console.log("  ->", name);
  }
}
rmSync(tmp, { recursive: true, force: true });
