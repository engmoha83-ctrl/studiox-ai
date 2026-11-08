//! FFmpeg / FFprobe integration: binary discovery, probing, thumbnails,
//! filmstrips, waveform peaks, proxies, export jobs and media analysis.

use crate::error::{msg, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Build a command that never opens a console window on Windows.
pub fn command(bin: &Path) -> Command {
    let mut c = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c.stdin(Stdio::null());
    c
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

#[derive(Clone, Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub found: bool,
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub version: Option<String>,
    pub major: u32,
    pub source: String,
}

#[derive(Clone, Default)]
pub struct Ffmpeg {
    pub info: FfmpegInfo,
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
}

impl Ffmpeg {
    pub fn ffmpeg(&self) -> AppResult<PathBuf> {
        self.ffmpeg.clone().ok_or_else(|| {
            crate::error::AppError::Msg("FFmpeg was not found. Install it or set its folder in Settings.".into())
        })
    }
    pub fn ffprobe(&self) -> AppResult<PathBuf> {
        self.ffprobe.clone().ok_or_else(|| {
            crate::error::AppError::Msg("FFprobe was not found. Install it or set its folder in Settings.".into())
        })
    }
}

fn version_of(bin: &Path) -> Option<String> {
    let out = command(bin).arg("-version").stdout(Stdio::piped()).stderr(Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().next()?.to_string();
    Some(line)
}

fn parse_major(version_line: &str) -> u32 {
    // "ffmpeg version 6.1.1-3ubuntu5 ..." | "ffmpeg version n7.1 ..." | "ffmpeg version N-118000-g..." (git master)
    let v = version_line.split_whitespace().nth(2).unwrap_or("");
    if v.starts_with("N-") || v.starts_with("git") {
        return 99;
    }
    let v = v.trim_start_matches('n');
    v.split(|c: char| !c.is_ascii_digit()).next().and_then(|d| d.parse().ok()).unwrap_or(0)
}

/// Locate ffmpeg/ffprobe: custom dir → bundled resources → next to exe → common dirs → PATH.
pub fn locate(app: &AppHandle, custom_dir: Option<String>) -> Ffmpeg {
    let mut dirs: Vec<(PathBuf, &str)> = vec![];
    if let Some(d) = custom_dir.filter(|d| !d.trim().is_empty()) {
        let p = PathBuf::from(d);
        let p = if p.is_file() { p.parent().map(|x| x.to_path_buf()).unwrap_or(p) } else { p };
        dirs.push((p, "settings"));
    }
    if let Ok(r) = app.path().resource_dir() {
        dirs.push((r.join("binaries"), "bundled"));
        dirs.push((r.clone(), "bundled"));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(d) = exe_path.parent() {
            dirs.push((d.join("binaries"), "bundled"));
            dirs.push((d.to_path_buf(), "bundled"));
        }
    }
    // Dev mode: src-tauri/binaries
    dirs.push((PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"), "bundled"));
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "C:\\ffmpeg\\bin"] {
        dirs.push((PathBuf::from(d), "system"));
    }
    for (dir, source) in dirs {
        let f = dir.join(exe("ffmpeg"));
        let p = dir.join(exe("ffprobe"));
        if f.is_file() && p.is_file() {
            if let Some(v) = version_of(&f) {
                return Ffmpeg {
                    info: FfmpegInfo {
                        found: true,
                        ffmpeg: Some(f.to_string_lossy().into()),
                        ffprobe: Some(p.to_string_lossy().into()),
                        major: parse_major(&v),
                        version: Some(v),
                        source: source.into(),
                    },
                    ffmpeg: Some(f),
                    ffprobe: Some(p),
                };
            }
        }
    }
    // PATH lookup
    let f = PathBuf::from(exe("ffmpeg"));
    let p = PathBuf::from(exe("ffprobe"));
    if let (Some(v), Some(_)) = (version_of(&f), version_of(&p)) {
        return Ffmpeg {
            info: FfmpegInfo {
                found: true,
                ffmpeg: Some("ffmpeg (PATH)".into()),
                ffprobe: Some("ffprobe (PATH)".into()),
                major: parse_major(&v),
                version: Some(v),
                source: "path".into(),
            },
            ffmpeg: Some(f),
            ffprobe: Some(p),
        };
    }
    Ffmpeg::default()
}

// ---------------------------------------------------------------- caching helpers

pub fn file_stamp(path: &Path) -> (u64, u64) {
    match std::fs::metadata(path) {
        Ok(m) => (
            m.len(),
            m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
        ),
        Err(_) => (0, 0),
    }
}

pub fn cache_key(path: &Path, extra: &str) -> String {
    let (size, mtime) = file_stamp(path);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().hash(&mut h);
    size.hash(&mut h);
    mtime.hash(&mut h);
    extra.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn run_ok(mut c: Command) -> AppResult<()> {
    let out = c.stdout(Stdio::null()).stderr(Stdio::piped()).output()?;
    if out.status.success() {
        Ok(())
    } else {
        let e = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = e.lines().rev().take(6).collect();
        msg(format!("FFmpeg failed: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" | ")))
    }
}

// ---------------------------------------------------------------- probe

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub kind: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub pix_fmt: Option<String>,
    pub has_video: bool,
    pub has_audio: bool,
    pub sample_rate: u32,
    pub channels: u32,
    pub size: u64,
    pub mtime: u64,
    pub format_name: String,
    pub rotation: i32,
    pub bit_rate: u64,
}

fn parse_rate(s: &str) -> f64 {
    let mut it = s.split('/');
    let n: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    let d: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(1.0);
    if d == 0.0 {
        0.0
    } else {
        n / d
    }
}

fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub fn probe(ff: &Ffmpeg, path: &Path) -> AppResult<ProbeResult> {
    if !path.is_file() {
        return msg(format!("File not found: {}", path.display()));
    }
    let out = command(&ff.ffprobe()?)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;
    if !out.status.success() {
        return msg(format!("Unsupported or damaged file: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let j: Value = serde_json::from_slice(&out.stdout)?;
    let format_name = j["format"]["format_name"].as_str().unwrap_or("").to_string();
    let streams = j["streams"].as_array().cloned().unwrap_or_default();
    let v = streams.iter().find(|s| {
        s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64().unwrap_or(0) == 0
    });
    let a = streams.iter().find(|s| s["codec_type"] == "audio");
    let (size, mtime) = file_stamp(path);
    let vcodec = v.and_then(|s| s["codec_name"].as_str()).map(String::from);
    let is_image = v.is_some()
        && (format_name.contains("image2") || format_name.ends_with("_pipe") || format_name == "webp")
        && vcodec.as_deref() != Some("gif");
    let mut duration = num(&j["format"]["duration"]);
    if duration <= 0.0 {
        duration = v.map(|s| num(&s["duration"])).unwrap_or(0.0).max(a.map(|s| num(&s["duration"])).unwrap_or(0.0));
    }
    let mut rotation = 0i32;
    if let Some(s) = v {
        if let Some(sd) = s["side_data_list"].as_array() {
            for d in sd {
                if d.get("rotation").is_some() {
                    rotation = num(&d["rotation"]) as i32;
                }
            }
        }
        if rotation == 0 {
            rotation = num(&s["tags"]["rotate"]) as i32;
        }
    }
    let (mut w, mut h) = v
        .map(|s| (s["width"].as_u64().unwrap_or(0) as u32, s["height"].as_u64().unwrap_or(0) as u32))
        .unwrap_or((0, 0));
    if rotation.abs() % 180 == 90 {
        std::mem::swap(&mut w, &mut h);
    }
    let fps = v
        .map(|s| {
            let f = parse_rate(s["avg_frame_rate"].as_str().unwrap_or("0/1"));
            if f > 0.0 && f < 1000.0 {
                f
            } else {
                parse_rate(s["r_frame_rate"].as_str().unwrap_or("0/1"))
            }
        })
        .unwrap_or(0.0);
    let kind = if is_image {
        "image"
    } else if v.is_some() {
        "video"
    } else if a.is_some() {
        "audio"
    } else {
        return msg("The file contains no video or audio stream.");
    };
    Ok(ProbeResult {
        kind: kind.into(),
        duration: if is_image { 0.0 } else { duration },
        width: w,
        height: h,
        fps,
        video_codec: vcodec,
        audio_codec: a.and_then(|s| s["codec_name"].as_str()).map(String::from),
        pix_fmt: v.and_then(|s| s["pix_fmt"].as_str()).map(String::from),
        has_video: v.is_some(),
        has_audio: a.is_some(),
        sample_rate: a.map(|s| num(&s["sample_rate"]) as u32).unwrap_or(0),
        channels: a.and_then(|s| s["channels"].as_u64()).unwrap_or(0) as u32,
        size,
        mtime,
        format_name,
        rotation,
        bit_rate: num(&j["format"]["bit_rate"]) as u64,
    })
}

// ---------------------------------------------------------------- thumbnails / filmstrip / waveform

pub fn thumbnail(ff: &Ffmpeg, cache: &Path, path: &Path, kind: &str, time: f64) -> AppResult<String> {
    let ext = if kind == "audio" { "png" } else { "jpg" };
    let out = cache.join(format!("thumb-{}.{}", cache_key(path, &format!("{kind}{time:.2}")), ext));
    if out.is_file() {
        return Ok(out.to_string_lossy().into());
    }
    let bin = ff.ffmpeg()?;
    let attempt = |t: f64| -> AppResult<()> {
        let mut c = command(&bin);
        c.args(["-hide_banner", "-loglevel", "error", "-y"]);
        match kind {
            "audio" => {
                c.arg("-i").arg(path).args([
                    "-filter_complex",
                    "aformat=channel_layouts=mono,showwavespic=s=320x180:colors=0x2dd4bf",
                    "-frames:v",
                    "1",
                ]);
            }
            "image" => {
                c.arg("-i").arg(path).args(["-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4"]);
            }
            _ => {
                c.args(["-ss", &format!("{t:.3}")]).arg("-i").arg(path).args([
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=320:-2",
                    "-q:v",
                    "4",
                ]);
            }
        }
        c.arg(&out);
        run_ok(c)?;
        if out.is_file() {
            Ok(())
        } else {
            msg("No frame decoded")
        }
    };
    if attempt(time).is_err() {
        attempt(0.0)?;
    }
    Ok(out.to_string_lossy().into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Filmstrip {
    pub path: String,
    pub count: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub interval: f64,
}

pub fn filmstrip(ff: &Ffmpeg, cache: &Path, path: &Path, duration: f64, width: u32, height: u32) -> AppResult<Filmstrip> {
    let duration = duration.max(0.04);
    let count = ((duration / 1.5).ceil() as u32).clamp(1, 120);
    let th = 64u32;
    let tw = (((th as f64) * (width.max(1) as f64) / (height.max(1) as f64)).round() as u32).max(2) & !1;
    let interval = duration / count as f64;
    let out = cache.join(format!("strip-{}.jpg", cache_key(path, &format!("{count}x{tw}"))));
    let result = Filmstrip { path: out.to_string_lossy().into(), count, tile_width: tw, tile_height: th, interval };
    if out.is_file() {
        return Ok(result);
    }
    let mut c = command(&ff.ffmpeg()?);
    c.args(["-hide_banner", "-loglevel", "error", "-y"]);
    if duration > 120.0 {
        c.args(["-skip_frame", "nokey"]);
    }
    c.arg("-i").arg(path).args([
        "-an",
        "-vf",
        &format!("fps={count}/{duration:.4},scale={tw}:{th},tile={count}x1"),
        "-frames:v",
        "1",
        "-q:v",
        "5",
    ]);
    c.arg(&out);
    run_ok(c)?;
    Ok(result)
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Waveform {
    pub peaks_per_second: f64,
    pub peaks: Vec<u8>,
}

pub fn waveform(ff: &Ffmpeg, cache: &Path, path: &Path, duration: f64) -> AppResult<Waveform> {
    let out = cache.join(format!("wave-{}.json", cache_key(path, "w1")));
    if let Ok(s) = std::fs::read_to_string(&out) {
        if let Ok(w) = serde_json::from_str::<Waveform>(&s) {
            return Ok(w);
        }
    }
    const RATE: f64 = 8000.0;
    let pps = if duration > 0.0 { (200_000.0 / duration).clamp(10.0, 100.0).floor() } else { 50.0 };
    let per_bucket = RATE / pps;
    let mut child = command(&ff.ffmpeg()?)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-acodec", "pcm_s16le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdout = child.stdout.take().unwrap();
    let mut buf = vec![0u8; 1 << 16];
    let mut peaks: Vec<u8> = Vec::new();
    let mut carry: Option<u8> = None;
    let mut count = 0.0f64;
    let mut cur_max = 0i32;
    loop {
        let n = stdout.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let mut i = 0;
        let mut bytes: Vec<u8> = Vec::with_capacity(n + 1);
        if let Some(c) = carry.take() {
            bytes.push(c);
        }
        bytes.extend_from_slice(&buf[..n]);
        while i + 1 < bytes.len() {
            let s = i16::from_le_bytes([bytes[i], bytes[i + 1]]) as i32;
            cur_max = cur_max.max(s.abs());
            count += 1.0;
            if count >= per_bucket {
                peaks.push(((cur_max as f64 / 32768.0).sqrt() * 255.0).min(255.0) as u8);
                count -= per_bucket;
                cur_max = 0;
            }
            i += 2;
        }
        if i < bytes.len() {
            carry = Some(bytes[i]);
        }
    }
    if count > 0.0 {
        peaks.push(((cur_max as f64 / 32768.0).sqrt() * 255.0).min(255.0) as u8);
    }
    let _ = child.wait();
    let w = Waveform { peaks_per_second: pps, peaks };
    let _ = std::fs::write(&out, serde_json::to_string(&w)?);
    Ok(w)
}

// ---------------------------------------------------------------- encoders

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCaps {
    pub video: Vec<String>,
    pub audio: Vec<String>,
    pub hardware: Vec<String>,
}

pub fn encoder_list(ff: &Ffmpeg) -> AppResult<(Vec<String>, Vec<String>)> {
    let out = command(&ff.ffmpeg()?).args(["-hide_banner", "-encoders"]).stdout(Stdio::piped()).stderr(Stdio::null()).output()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let mut v = vec![];
    let mut a = vec![];
    for line in s.lines() {
        let t = line.trim_start();
        let mut parts = t.split_whitespace();
        let (Some(flags), Some(name)) = (parts.next(), parts.next()) else { continue };
        if flags.len() != 6 || name == "=" {
            continue;
        }
        if flags.starts_with('V') {
            v.push(name.to_string());
        } else if flags.starts_with('A') {
            a.push(name.to_string());
        }
    }
    Ok((v, a))
}

const HW_CANDIDATES: &[&str] = &[
    "h264_nvenc", "hevc_nvenc", "av1_nvenc", "h264_qsv", "hevc_qsv", "av1_qsv", "h264_amf", "hevc_amf", "av1_amf",
    "h264_videotoolbox", "hevc_videotoolbox", "prores_videotoolbox", "h264_mf", "hevc_mf",
];

/// Detect encoders; hardware encoders are verified by encoding real test frames.
pub fn encoder_caps(ff: &Ffmpeg) -> AppResult<EncoderCaps> {
    let (v, a) = encoder_list(ff)?;
    let bin = ff.ffmpeg()?;
    let candidates: Vec<String> = HW_CANDIDATES.iter().filter(|c| v.iter().any(|x| x == **c)).map(|s| s.to_string()).collect();
    let handles: Vec<_> = candidates
        .into_iter()
        .map(|enc| {
            let bin = bin.clone();
            std::thread::spawn(move || {
                let ok = command(&bin)
                    .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=0.3"])
                    .args(["-pix_fmt", "yuv420p", "-frames:v", "5", "-c:v", &enc, "-f", "null", "-"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                (enc, ok)
            })
        })
        .collect();
    let hardware: Vec<String> = handles.into_iter().filter_map(|h| h.join().ok()).filter(|(_, ok)| *ok).map(|(e, _)| e).collect();
    let soft_video = ["libx264", "libx265", "libsvtav1", "libaom-av1", "libvpx-vp9", "prores_ks", "libopenh264"];
    let soft_audio = ["aac", "libopus", "libmp3lame", "pcm_s16le", "pcm_s24le", "alac", "libfdk_aac"];
    Ok(EncoderCaps {
        video: soft_video.iter().filter(|c| v.iter().any(|x| x == **c)).map(|s| s.to_string()).chain(hardware.clone()).collect(),
        audio: soft_audio.iter().filter(|c| a.iter().any(|x| x == **c)).map(|s| s.to_string()).collect(),
        hardware,
    })
}

pub fn pick_h264(caps: &EncoderCaps) -> Vec<String> {
    let order = ["libx264", "h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox", "h264_mf", "libopenh264"];
    order.iter().filter(|e| caps.video.iter().any(|v| v == **e)).map(|s| s.to_string()).collect()
}

// ---------------------------------------------------------------- background jobs

pub struct JobHandle {
    pub child: Arc<Mutex<Child>>,
    pub cancelled: Arc<AtomicBool>,
}
pub type Jobs = Arc<Mutex<HashMap<String, JobHandle>>>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JobProgress {
    id: String,
    kind: String,
    progress: f64,
    out_time: f64,
    fps: f64,
    speed: String,
    elapsed: f64,
    eta: Option<f64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JobEnd {
    id: String,
    kind: String,
    output: Option<String>,
    message: Option<String>,
    elapsed: f64,
}

pub struct JobSpec {
    pub id: String,
    pub kind: String,
    pub bin: PathBuf,
    pub args: Vec<String>,
    pub total: f64,
    pub tmp_out: PathBuf,
    pub final_out: PathBuf,
    pub cleanup_dir: Option<PathBuf>,
}

pub fn spawn_job(app: AppHandle, jobs: Jobs, spec: JobSpec) -> AppResult<()> {
    let mut cmd = command(&spec.bin);
    cmd.args(&spec.args).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    jobs.lock().unwrap().insert(spec.id.clone(), JobHandle { child: child.clone(), cancelled: cancelled.clone() });

    let tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let tail2 = tail.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut t = tail2.lock().unwrap();
            t.push_back(line);
            if t.len() > 40 {
                t.pop_front();
            }
        }
    });

    std::thread::spawn(move || {
        let start = Instant::now();
        let (mut out_time, mut fps, mut speed) = (0.0f64, 0.0f64, String::new());
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(v) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
                if let Ok(us) = v.trim().parse::<i64>() {
                    out_time = (us as f64 / 1_000_000.0).max(0.0);
                }
            } else if let Some(v) = line.strip_prefix("fps=") {
                fps = v.trim().parse().unwrap_or(fps);
            } else if let Some(v) = line.strip_prefix("speed=") {
                speed = v.trim().to_string();
            } else if line.starts_with("progress=") {
                if last_emit.elapsed() < Duration::from_millis(200) && !line.ends_with("end") {
                    continue;
                }
                last_emit = Instant::now();
                let p = if spec.total > 0.0 { (out_time / spec.total).clamp(0.0, 1.0) } else { 0.0 };
                let elapsed = start.elapsed().as_secs_f64();
                let eta = if p > 0.01 { Some(elapsed * (1.0 - p) / p) } else { None };
                let _ = app.emit(
                    "job-progress",
                    JobProgress { id: spec.id.clone(), kind: spec.kind.clone(), progress: p, out_time, fps, speed: speed.clone(), elapsed, eta },
                );
            }
        }
        let status = loop {
            match child.lock().unwrap().try_wait() {
                Ok(Some(s)) => break Some(s),
                Ok(None) => {}
                Err(_) => break None,
            }
            std::thread::sleep(Duration::from_millis(80));
        };
        jobs.lock().unwrap().remove(&spec.id);
        let elapsed = start.elapsed().as_secs_f64();
        if let Some(d) = &spec.cleanup_dir {
            let _ = std::fs::remove_dir_all(d);
        }
        let end = |output: Option<String>, message: Option<String>| JobEnd {
            id: spec.id.clone(),
            kind: spec.kind.clone(),
            output,
            message,
            elapsed,
        };
        if cancelled.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&spec.tmp_out);
            let _ = app.emit("job-cancelled", end(None, None));
            return;
        }
        if status.map(|s| s.success()).unwrap_or(false) && spec.tmp_out.is_file() {
            let _ = std::fs::remove_file(&spec.final_out);
            match std::fs::rename(&spec.tmp_out, &spec.final_out) {
                Ok(_) => {
                    let _ = app.emit("job-done", end(Some(spec.final_out.to_string_lossy().into()), None));
                }
                Err(e) => {
                    let _ = app.emit("job-error", end(None, Some(format!("Could not finalize output file: {e}"))));
                }
            }
        } else {
            let _ = std::fs::remove_file(&spec.tmp_out);
            let t = tail.lock().unwrap();
            let relevant: Vec<String> =
                t.iter().filter(|l| !l.trim().is_empty()).rev().take(8).cloned().collect::<Vec<_>>().into_iter().rev().collect();
            let _ = app.emit("job-error", end(None, Some(relevant.join("\n"))));
        }
    });
    Ok(())
}

pub fn cancel_job(jobs: &Jobs, id: &str) -> bool {
    if let Some(j) = jobs.lock().unwrap().get(id) {
        j.cancelled.store(true, Ordering::SeqCst);
        let _ = j.child.lock().unwrap().kill();
        true
    } else {
        false
    }
}

/// Build proxy transcode arguments (H.264 540p short GOP for fast scrubbing).
pub fn proxy_args(src: &Path, tmp_out: &Path, encoder: &str, has_audio: bool) -> Vec<String> {
    let mut a: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-i".into(), src.to_string_lossy().into()];
    a.extend(["-map", "0:v:0"].map(String::from));
    if has_audio {
        a.extend(["-map", "0:a:0"].map(String::from));
    }
    a.extend(["-vf", "scale=-2:'min(540,ih)',format=yuv420p", "-c:v", encoder].map(String::from));
    match encoder {
        "libx264" => a.extend(["-preset", "veryfast", "-crf", "26", "-tune", "fastdecode"].map(String::from)),
        "libopenh264" => a.extend(["-b:v", "2M"].map(String::from)),
        _ => a.extend(["-b:v", "3M"].map(String::from)),
    }
    a.extend(["-g", "12", "-bf", "0"].map(String::from));
    if has_audio {
        a.extend(["-c:a", "aac", "-b:a", "128k", "-ac", "2"].map(String::from));
    }
    a.extend(["-movflags", "+faststart", "-f", "mp4", "-progress", "pipe:1", "-nostats"].map(String::from));
    a.push(tmp_out.to_string_lossy().into());
    a
}

// ---------------------------------------------------------------- analysis (local, FFmpeg based)

pub fn detect_silence(ff: &Ffmpeg, path: &Path, noise_db: f64, min_dur: f64) -> AppResult<Vec<(f64, f64)>> {
    let out = command(&ff.ffmpeg()?)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(path)
        .args(["-vn", "-af", &format!("silencedetect=n={noise_db}dB:d={min_dur}"), "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()?;
    let s = String::from_utf8_lossy(&out.stderr);
    let mut res = vec![];
    let mut start: Option<f64> = None;
    for line in s.lines() {
        if let Some(i) = line.find("silence_start: ") {
            start = line[i + 15..].split_whitespace().next().and_then(|x| x.parse().ok());
        } else if let Some(i) = line.find("silence_end: ") {
            let end: Option<f64> = line[i + 13..].split_whitespace().next().and_then(|x| x.parse().ok());
            if let (Some(st), Some(en)) = (start.take(), end) {
                res.push((st.max(0.0), en));
            }
        }
    }
    if let Some(st) = start {
        res.push((st, f64::INFINITY));
    }
    Ok(res)
}

pub fn detect_scenes(ff: &Ffmpeg, path: &Path, threshold: f64) -> AppResult<Vec<f64>> {
    let out = command(&ff.ffmpeg()?)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(path)
        .args(["-an", "-vf", &format!("scale=320:-2,select='gt(scene,{threshold})',showinfo"), "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()?;
    let s = String::from_utf8_lossy(&out.stderr);
    let mut res = vec![];
    for line in s.lines() {
        if !line.contains("Parsed_showinfo") {
            continue;
        }
        if let Some(i) = line.find("pts_time:") {
            if let Some(t) = line[i + 9..].split_whitespace().next().and_then(|x| x.parse::<f64>().ok()) {
                res.push(t);
            }
        }
    }
    Ok(res)
}
