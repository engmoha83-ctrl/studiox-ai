//! Local AI: whisper.cpp speech recognition + model manager (download / delete with progress).
//! Everything runs on this computer; the only network access is the explicit model download.

use crate::error::{msg, AppResult};
use crate::ffmpeg::{command, Ffmpeg};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub type Cancels = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// whisper-cli lookup: custom dir → bundled resources → next to the exe → PATH.
pub fn locate_whisper(app: &AppHandle, custom_dir: Option<String>) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(d) = custom_dir.filter(|d| !d.trim().is_empty()) {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(r) = app.path().resource_dir() {
        dirs.push(r.join("binaries").join("whisper"));
        dirs.push(r.join("binaries"));
    }
    if let Ok(e) = std::env::current_exe() {
        if let Some(d) = e.parent() {
            dirs.push(d.join("binaries").join("whisper"));
        }
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("whisper"));
    for d in dirs {
        for name in ["whisper-cli", "whisper-cpp", "main"] {
            let p = d.join(exe(name));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    for name in ["whisper-cli", "whisper-cpp"] {
        let p = PathBuf::from(exe(name));
        if command(&p).arg("-h").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok() {
            return Some(p);
        }
    }
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub file: String,
    pub path: String,
    pub size: u64,
}

pub fn list_models(dir: &Path) -> Vec<ModelFile> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.ends_with(".bin") {
                out.push(ModelFile { size: e.metadata().map(|m| m.len()).unwrap_or(0), path: p.to_string_lossy().into(), file: name });
            }
        }
    }
    out.sort_by(|a, b| a.file.cmp(&b.file));
    out
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    kind: String,
    progress: f64,
    received: u64,
    total: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct End {
    id: String,
    kind: String,
    output: Option<String>,
    message: Option<String>,
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) && name.ends_with(".bin")
}

/// Download a model file with progress events ("ai-progress" / "ai-done" / "ai-error").
pub fn start_download(app: AppHandle, cancels: Cancels, id: String, url: String, dir: PathBuf, file: String) -> AppResult<()> {
    if !safe_name(&file) || !(url.starts_with("https://huggingface.co/") || url.starts_with("https://github.com/")) {
        return msg("Refusing to download from an unexpected location.");
    }
    std::fs::create_dir_all(&dir)?;
    let flag = Arc::new(AtomicBool::new(false));
    cancels.lock().unwrap().insert(id.clone(), flag.clone());
    std::thread::spawn(move || {
        let fin = dir.join(&file);
        let part = dir.join(format!("{file}.part"));
        let res = (|| -> Result<(), String> {
            let resp = ureq::get(&url).call().map_err(|e| e.to_string())?;
            let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
            let mut reader = resp.into_reader();
            let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 1 << 20];
            let mut received = 0u64;
            let mut last = Instant::now() - Duration::from_secs(1);
            loop {
                if flag.load(Ordering::SeqCst) {
                    return Err("cancelled".into());
                }
                let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                received += n as u64;
                if last.elapsed() > Duration::from_millis(250) {
                    last = Instant::now();
                    let p = if total > 0 { received as f64 / total as f64 } else { 0.0 };
                    let _ = app.emit("ai-progress", Progress { id: id.clone(), kind: "download".into(), progress: p, received, total });
                }
            }
            f.flush().map_err(|e| e.to_string())?;
            drop(f);
            if total > 0 && received != total {
                return Err(format!("Incomplete download ({received} of {total} bytes)"));
            }
            std::fs::rename(&part, &fin).map_err(|e| e.to_string())?;
            Ok(())
        })();
        cancels.lock().unwrap().remove(&id);
        match res {
            Ok(()) => {
                let _ = app.emit("ai-done", End { id, kind: "download".into(), output: Some(fin.to_string_lossy().into()), message: None });
            }
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                let _ = app.emit("ai-error", End { id, kind: "download".into(), output: None, message: Some(e) });
            }
        }
    });
    Ok(())
}

pub fn cancel(cancels: &Cancels, id: &str) -> bool {
    if let Some(f) = cancels.lock().unwrap().get(id) {
        f.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

pub struct TranscribeSpec {
    pub id: String,
    pub media: PathBuf,
    pub start: f64,
    pub duration: f64,
    pub model: PathBuf,
    pub language: String,
    pub translate: bool,
    pub max_len: u32,
    pub work_dir: PathBuf,
}

/// Run whisper.cpp over a source range. Emits progress; on success "ai-done" carries the JSON path.
pub fn start_transcribe(app: AppHandle, cancels: Cancels, ff: Ffmpeg, whisper: PathBuf, spec: TranscribeSpec) -> AppResult<()> {
    if !spec.model.is_file() {
        return msg("The selected model file is missing. Download it again in Settings → AI models.");
    }
    std::fs::create_dir_all(&spec.work_dir)?;
    let flag = Arc::new(AtomicBool::new(false));
    cancels.lock().unwrap().insert(spec.id.clone(), flag.clone());
    let ffmpeg = ff.ffmpeg()?;
    std::thread::spawn(move || {
        let wav = spec.work_dir.join("audio.wav");
        let out_base = spec.work_dir.join("transcript");
        let res = (|| -> Result<PathBuf, String> {
            // 1. 16 kHz mono PCM, as whisper.cpp expects
            let st = command(&ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", &format!("{:.3}", spec.start), "-t", &format!("{:.3}", spec.duration), "-i"])
                .arg(&spec.media)
                .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
                .arg(&wav)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| e.to_string())?;
            if !st.status.success() {
                return Err(format!("Audio extraction failed: {}", String::from_utf8_lossy(&st.stderr)));
            }
            // 2. whisper.cpp
            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
            let mut cmd = command(&whisper);
            cmd.arg("-m").arg(&spec.model).arg("-f").arg(&wav);
            cmd.args(["-l", if spec.language.is_empty() { "auto" } else { &spec.language }, "-t", &threads.to_string(), "-oj", "-pp"]);
            if spec.max_len > 0 {
                cmd.args(["-ml", &spec.max_len.to_string(), "-sow"]);
            }
            if spec.translate {
                cmd.arg("-tr");
            }
            cmd.arg("-of").arg(&out_base).stdout(Stdio::null()).stderr(Stdio::piped());
            let mut child = cmd.spawn().map_err(|e| format!("Could not start whisper.cpp: {e}"))?;
            let stderr = child.stderr.take().unwrap();
            let mut tail: Vec<String> = vec![];
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if flag.load(Ordering::SeqCst) {
                    let _ = child.kill();
                    return Err("cancelled".into());
                }
                if let Some(i) = line.find("progress = ") {
                    if let Ok(p) = line[i + 11..].trim().trim_end_matches('%').trim().parse::<f64>() {
                        let _ = app.emit("ai-progress", Progress { id: spec.id.clone(), kind: "transcribe".into(), progress: p / 100.0, received: 0, total: 0 });
                    }
                } else {
                    tail.push(line);
                    if tail.len() > 12 {
                        tail.remove(0);
                    }
                }
            }
            let status = child.wait().map_err(|e| e.to_string())?;
            if flag.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            let json = out_base.with_extension("json");
            if !status.success() || !json.is_file() {
                return Err(format!("whisper.cpp failed: {}", tail.join(" | ")));
            }
            Ok(json)
        })();
        cancels.lock().unwrap().remove(&spec.id);
        let _ = std::fs::remove_file(&wav);
        match res {
            Ok(p) => {
                let _ = app.emit("ai-done", End { id: spec.id, kind: "transcribe".into(), output: Some(p.to_string_lossy().into()), message: None });
            }
            Err(e) => {
                let _ = app.emit("ai-error", End { id: spec.id, kind: "transcribe".into(), output: None, message: Some(e) });
            }
        }
    });
    Ok(())
}

/// Is an Ollama server running locally? Returns installed model names.
pub fn ollama_models() -> Option<Vec<String>> {
    let resp = ureq::get("http://127.0.0.1:11434/api/tags").timeout(Duration::from_millis(800)).call().ok()?;
    let v: serde_json::Value = resp.into_json().ok()?;
    Some(v["models"].as_array()?.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
}

/// Ask a local Ollama model for a JSON answer.
pub fn ollama_chat(model: &str, system: &str, user: &str) -> AppResult<String> {
    let body = serde_json::json!({
        "model": model, "stream": false, "format": "json",
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "options": {"temperature": 0.1}
    });
    let resp = ureq::post("http://127.0.0.1:11434/api/chat")
        .timeout(Duration::from_secs(180))
        .send_json(body)
        .map_err(|e| crate::error::AppError::Msg(format!("Ollama request failed: {e}")))?;
    let v: serde_json::Value = resp.into_json()?;
    Ok(v["message"]["content"].as_str().unwrap_or("").to_string())
}
