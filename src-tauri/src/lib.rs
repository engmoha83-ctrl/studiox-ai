mod ai;
mod db;
mod error;
mod ffmpeg;
mod files;
mod media_server;
mod system;
mod vision;

use base64::Engine;
use error::{msg, AppResult};
use ffmpeg::{EncoderCaps, Ffmpeg, Jobs};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Manager, State};

pub struct Dirs {
    pub data: PathBuf,
    pub cache: PathBuf,
    pub temp: PathBuf,
    pub proxies: PathBuf,
    pub models: PathBuf,
}

pub struct AppState {
    db: Arc<db::Db>,
    dirs: Dirs,
    ff: RwLock<Ffmpeg>,
    jobs: Jobs,
    caps: Mutex<Option<EncoderCaps>>,
    media_base: String,
    whisper: RwLock<Option<PathBuf>>,
    ai_cancels: ai::Cancels,
}

impl AppState {
    fn ff(&self) -> Ffmpeg {
        self.ff.read().unwrap().clone()
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| error::AppError::Msg(e.to_string()))?
}

// ------------------------------------------------------------------ app / ffmpeg

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    cache_dir: String,
    platform: String,
    media_base: String,
    ffmpeg: ffmpeg::FfmpegInfo,
}

#[tauri::command]
async fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.dirs.data.to_string_lossy().into(),
        cache_dir: state.dirs.cache.to_string_lossy().into(),
        platform: std::env::consts::OS.into(),
        media_base: state.media_base.clone(),
        ffmpeg: state.ff().info,
    })
}

#[tauri::command]
async fn set_ffmpeg_dir(app: AppHandle, state: State<'_, AppState>, dir: String) -> AppResult<ffmpeg::FfmpegInfo> {
    let app2 = app.clone();
    let d = dir.clone();
    let found = blocking(move || Ok(ffmpeg::locate(&app2, Some(d)))).await?;
    if !dir.trim().is_empty() && found.info.source != "settings" {
        return msg("ffmpeg and ffprobe were not found in that folder.");
    }
    state.db.set_setting("ffmpegDir", &dir)?;
    *state.caps.lock().unwrap() = None;
    let info = found.info.clone();
    *state.ff.write().unwrap() = found;
    Ok(info)
}

#[tauri::command]
async fn system_info(state: State<'_, AppState>) -> AppResult<system::SystemInfo> {
    let d = state.dirs.data.clone();
    blocking(move || Ok(system::detect(&d))).await
}

#[tauri::command]
async fn encoder_caps(state: State<'_, AppState>) -> AppResult<EncoderCaps> {
    if let Some(c) = state.caps.lock().unwrap().clone() {
        return Ok(c);
    }
    let ff = state.ff();
    let caps = blocking(move || ffmpeg::encoder_caps(&ff)).await?;
    *state.caps.lock().unwrap() = Some(caps.clone());
    Ok(caps)
}

// ------------------------------------------------------------------ media

#[tauri::command]
async fn probe_media(state: State<'_, AppState>, path: String) -> AppResult<serde_json::Value> {
    let p = PathBuf::from(&path);
    let (size, mtime) = ffmpeg::file_stamp(&p);
    if let Some(cached) = state.db.cached_probe(&path, size, mtime)? {
        if let Ok(v) = serde_json::from_str(&cached) {
            return Ok(v);
        }
    }
    let ff = state.ff();
    let r = blocking(move || ffmpeg::probe(&ff, &p)).await?;
    let v = serde_json::to_value(&r)?;
    let _ = state.db.store_probe(&path, size, mtime, &r.kind, &v.to_string());
    Ok(v)
}

#[tauri::command]
async fn make_thumbnail(state: State<'_, AppState>, path: String, kind: String, time: f64) -> AppResult<String> {
    let ff = state.ff();
    let cache = state.dirs.cache.clone();
    blocking(move || ffmpeg::thumbnail(&ff, &cache, &PathBuf::from(path), &kind, time)).await
}

#[tauri::command]
async fn make_filmstrip(state: State<'_, AppState>, path: String, duration: f64, width: u32, height: u32) -> AppResult<ffmpeg::Filmstrip> {
    let ff = state.ff();
    let cache = state.dirs.cache.clone();
    blocking(move || ffmpeg::filmstrip(&ff, &cache, &PathBuf::from(path), duration, width, height)).await
}

#[tauri::command]
async fn make_waveform(state: State<'_, AppState>, path: String, duration: f64) -> AppResult<ffmpeg::Waveform> {
    let ff = state.ff();
    let cache = state.dirs.cache.clone();
    blocking(move || ffmpeg::waveform(&ff, &cache, &PathBuf::from(path), duration)).await
}

#[tauri::command]
async fn start_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    path: String,
    duration: f64,
    has_audio: bool,
) -> AppResult<String> {
    let src = PathBuf::from(&path);
    let final_out = state.dirs.proxies.join(format!("proxy-{}.mp4", ffmpeg::cache_key(&src, "p540")));
    if final_out.is_file() {
        return Ok(final_out.to_string_lossy().into());
    }
    let caps = encoder_caps(state.clone()).await?;
    let enc = ffmpeg::pick_h264(&caps).into_iter().next().ok_or_else(|| error::AppError::Msg("No H.264 encoder available for proxies".into()))?;
    let tmp = final_out.with_extension("part");
    let args = ffmpeg::proxy_args(&src, &tmp, &enc, has_audio);
    ffmpeg::spawn_job(
        app,
        state.jobs.clone(),
        ffmpeg::JobSpec {
            id: job_id,
            kind: "proxy".into(),
            bin: state.ff().ffmpeg()?,
            args,
            total: duration,
            tmp_out: tmp,
            final_out,
            cleanup_dir: None,
        },
    )?;
    Ok(String::new())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    job_id: String,
    input_args: Vec<String>,
    filter_graph: String,
    output_args: Vec<String>,
    output_path: String,
    duration: f64,
}

/// Write a temporary file for a job (e.g. rasterised text layers). Returns its path.
#[tauri::command]
async fn write_job_file(state: State<'_, AppState>, job_id: String, name: String, base64_data: String) -> AppResult<String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return msg("Invalid file name");
    }
    let dir = state.dirs.temp.join(&job_id);
    std::fs::create_dir_all(&dir)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_data.as_bytes()).map_err(|e| error::AppError::Msg(e.to_string()))?;
    let p = dir.join(name);
    std::fs::write(&p, bytes)?;
    Ok(p.to_string_lossy().into())
}

#[tauri::command]
async fn start_export(app: AppHandle, state: State<'_, AppState>, req: ExportRequest) -> AppResult<()> {
    let ff = state.ff();
    let bin = ff.ffmpeg()?;
    let out = PathBuf::from(&req.output_path);
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return msg("The output folder does not exist.");
        }
    }
    let job_dir = state.dirs.temp.join(&req.job_id);
    std::fs::create_dir_all(&job_dir)?;
    let script = job_dir.join("graph.txt");
    std::fs::write(&script, &req.filter_graph)?;
    let tmp = PathBuf::from(format!("{}.part", req.output_path));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    // Filter graphs run single-threaded by default; use every core for compositing.
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-filter_complex_threads".into(), threads.to_string()];
    args.extend(req.input_args);
    if ff.info.major >= 7 {
        args.push("-/filter_complex".into());
    } else {
        args.push("-filter_complex_script".into());
    }
    args.push(script.to_string_lossy().into());
    args.extend(req.output_args);
    args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);
    args.push(tmp.to_string_lossy().into());
    ffmpeg::spawn_job(
        app,
        state.jobs.clone(),
        ffmpeg::JobSpec {
            id: req.job_id,
            kind: "export".into(),
            bin,
            args,
            total: req.duration,
            tmp_out: tmp,
            final_out: out,
            cleanup_dir: Some(job_dir),
        },
    )
}

#[tauri::command]
async fn cancel_job(state: State<'_, AppState>, job_id: String) -> AppResult<bool> {
    Ok(ffmpeg::cancel_job(&state.jobs, &job_id))
}

#[derive(Serialize)]
struct Range {
    start: f64,
    end: f64,
}

#[tauri::command]
async fn detect_silence(state: State<'_, AppState>, path: String, noise_db: f64, min_duration: f64) -> AppResult<Vec<Range>> {
    let ff = state.ff();
    let r = blocking(move || ffmpeg::detect_silence(&ff, &PathBuf::from(path), noise_db, min_duration)).await?;
    Ok(r.into_iter().map(|(s, e)| Range { start: s, end: if e.is_finite() { e } else { -1.0 } }).collect())
}

#[tauri::command]
async fn analyze_focus(state: State<'_, AppState>, path: String, start: f64, duration: f64) -> AppResult<Vec<ffmpeg::Focus>> {
    let ff = state.ff();
    blocking(move || ffmpeg::analyze_focus(&ff, &PathBuf::from(path), start, duration)).await
}

#[derive(Serialize, Clone)]
struct VisionProgress {
    id: String,
    kind: &'static str,
    progress: f64,
    received: u64,
    total: u64,
}

/// Face detection over a source range (local YuNet model). Progress: `ai-progress` kind "faces".
#[tauri::command]
async fn analyze_faces(app: AppHandle, state: State<'_, AppState>, job_id: String, path: String, start: f64, duration: f64, rate: f64) -> AppResult<Vec<vision::FaceFrame>> {
    use tauri::Emitter;
    let ff = state.ff();
    let flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state.ai_cancels.lock().unwrap().insert(job_id.clone(), flag.clone());
    let cancels = state.ai_cancels.clone();
    let id = job_id.clone();
    let res = blocking(move || {
        let mut last = -1.0;
        vision::analyze_faces(&ff, &PathBuf::from(path), start, duration, rate.clamp(0.5, 8.0), Some(flag), |p| {
            if p - last >= 0.02 || p >= 1.0 {
                last = p;
                let _ = app.emit("ai-progress", VisionProgress { id: id.clone(), kind: "faces", progress: p, received: 0, total: 0 });
            }
        })
    })
    .await;
    cancels.lock().unwrap().remove(&job_id);
    res
}

#[tauri::command]
async fn detect_scenes(state: State<'_, AppState>, path: String, threshold: f64) -> AppResult<Vec<f64>> {
    let ff = state.ff();
    blocking(move || ffmpeg::detect_scenes(&ff, &PathBuf::from(path), threshold)).await
}

// ------------------------------------------------------------------ local AI

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    whisper: Option<String>,
    models_dir: String,
    models: Vec<ai::ModelFile>,
    ollama: Option<Vec<String>>,
}

#[tauri::command]
async fn ai_status(state: State<'_, AppState>) -> AppResult<AiStatus> {
    let dir = state.dirs.models.clone();
    let whisper = state.whisper.read().unwrap().clone();
    let ollama = blocking(|| Ok(ai::ollama_models())).await?;
    Ok(AiStatus { whisper: whisper.map(|p| p.to_string_lossy().into()), models: ai::list_models(&dir), models_dir: dir.to_string_lossy().into(), ollama })
}

#[tauri::command]
async fn ai_set_whisper_dir(app: AppHandle, state: State<'_, AppState>, dir: String) -> AppResult<Option<String>> {
    let found = ai::locate_whisper(&app, Some(dir.clone()));
    if found.is_none() {
        return msg("whisper-cli was not found in that folder.");
    }
    state.db.set_setting("whisperDir", &dir)?;
    *state.whisper.write().unwrap() = found.clone();
    Ok(found.map(|p| p.to_string_lossy().into()))
}

#[tauri::command]
async fn ai_download_model(app: AppHandle, state: State<'_, AppState>, job_id: String, url: String, file: String) -> AppResult<()> {
    ai::start_download(app, state.ai_cancels.clone(), job_id, url, state.dirs.models.clone(), file)
}

#[tauri::command]
async fn ai_delete_model(state: State<'_, AppState>, file: String) -> AppResult<()> {
    if file.contains('/') || file.contains('\\') || !file.ends_with(".bin") {
        return msg("Invalid model name");
    }
    std::fs::remove_file(state.dirs.models.join(file))?;
    Ok(())
}

#[tauri::command]
async fn ai_cancel(state: State<'_, AppState>, job_id: String) -> AppResult<bool> {
    Ok(ai::cancel(&state.ai_cancels, &job_id))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeRequest {
    job_id: String,
    media: String,
    start: f64,
    duration: f64,
    model_file: String,
    language: String,
    translate: bool,
    max_len: u32,
}

#[tauri::command]
async fn ai_transcribe(app: AppHandle, state: State<'_, AppState>, req: TranscribeRequest) -> AppResult<()> {
    let whisper = state.whisper.read().unwrap().clone().ok_or_else(|| error::AppError::Msg("The speech recognition engine (whisper.cpp) is not installed.".into()))?;
    let spec = ai::TranscribeSpec {
        work_dir: state.dirs.temp.join(&req.job_id),
        id: req.job_id,
        media: PathBuf::from(req.media),
        start: req.start,
        duration: req.duration,
        model: state.dirs.models.join(&req.model_file),
        language: req.language,
        translate: req.translate,
        max_len: req.max_len,
    };
    ai::start_transcribe(app, state.ai_cancels.clone(), state.ff(), whisper, spec)
}

#[tauri::command]
async fn ai_ollama_chat(model: String, system: String, user: String) -> AppResult<String> {
    blocking(move || ai::ollama_chat(&model, &system, &user)).await
}

// ------------------------------------------------------------------ files

#[tauri::command]
async fn files_exist(paths: Vec<String>) -> AppResult<Vec<bool>> {
    Ok(files::exists_many(&paths))
}

#[tauri::command]
async fn find_files_in_dir(dir: String, names: Vec<String>) -> AppResult<std::collections::HashMap<String, String>> {
    blocking(move || Ok(files::find_by_name(&PathBuf::from(dir), &names, 8))).await
}

#[tauri::command]
async fn read_text_file(path: String) -> AppResult<String> {
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
async fn write_text_file(path: String, content: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    let tmp = p.with_extension("tmp-write");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

// ------------------------------------------------------------------ database

#[tauri::command]
async fn db_list_projects(state: State<'_, AppState>) -> AppResult<Vec<db::ProjectMeta>> {
    state.db.list_projects()
}
#[tauri::command]
async fn db_save_project(state: State<'_, AppState>, data: String, thumbnail: Option<String>) -> AppResult<i64> {
    let db = state.db.clone();
    blocking(move || db.save_project(&data, thumbnail)).await
}
#[tauri::command]
async fn db_load_project(state: State<'_, AppState>, id: String) -> AppResult<String> {
    state.db.load_project(&id)
}
#[tauri::command]
async fn db_rename_project(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    state.db.rename_project(&id, &name)
}
#[tauri::command]
async fn db_duplicate_project(state: State<'_, AppState>, id: String, new_id: String, new_name: String) -> AppResult<()> {
    state.db.duplicate_project(&id, &new_id, &new_name)
}
#[tauri::command]
async fn db_set_archived(state: State<'_, AppState>, id: String, archived: bool) -> AppResult<()> {
    state.db.set_archived(&id, archived)
}
#[tauri::command]
async fn db_set_folder(state: State<'_, AppState>, id: String, folder: String) -> AppResult<()> {
    state.db.set_folder(&id, &folder)
}
#[tauri::command]
async fn db_delete_project(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_project(&id)
}
#[tauri::command]
async fn db_add_backup(state: State<'_, AppState>, project_id: String, label: String, kind: String, data: String) -> AppResult<i64> {
    let db = state.db.clone();
    blocking(move || db.add_backup(&project_id, &label, &kind, &data)).await
}
#[tauri::command]
async fn db_list_backups(state: State<'_, AppState>, project_id: String) -> AppResult<Vec<db::BackupMeta>> {
    state.db.list_backups(&project_id)
}
#[tauri::command]
async fn db_get_backup(state: State<'_, AppState>, id: i64) -> AppResult<String> {
    state.db.get_backup(id)
}
#[tauri::command]
async fn db_delete_backup(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.delete_backup(id)
}
#[tauri::command]
async fn get_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    state.db.get_setting(&key)
}
#[tauri::command]
async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    state.db.set_setting(&key, &value)
}

// ------------------------------------------------------------------ entry

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            let data = handle.path().app_data_dir()?;
            let cache_root = handle.path().app_cache_dir()?;
            let dirs = Dirs { cache: cache_root.join("media"), temp: cache_root.join("tmp"), proxies: data.join("proxies"), models: data.join("models").join("whisper"), data };
            for d in [&dirs.data, &dirs.cache, &dirs.temp, &dirs.proxies, &dirs.models] {
                std::fs::create_dir_all(d)?;
            }
            // Leftover temp files from an interrupted session (e.g. crash during export)
            if let Ok(rd) = std::fs::read_dir(&dirs.temp) {
                for e in rd.flatten() {
                    let _ = std::fs::remove_dir_all(e.path());
                }
            }
            let db = db::Db::open(&dirs.data.join("studiox.db")).map_err(|e| e.to_string())?;
            let custom = db.get_setting("ffmpegDir").ok().flatten();
            let ff = ffmpeg::locate(handle, custom);
            let server = media_server::start()?;
            let whisper = ai::locate_whisper(handle, db.get_setting("whisperDir").ok().flatten());
            app.manage(AppState {
                media_base: server.base_url,
                db: Arc::new(db),
                dirs,
                ff: RwLock::new(ff),
                jobs: Arc::new(Mutex::new(Default::default())),
                caps: Mutex::new(None),
                whisper: RwLock::new(whisper),
                ai_cancels: Arc::new(Mutex::new(Default::default())),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            set_ffmpeg_dir,
            system_info,
            encoder_caps,
            probe_media,
            make_thumbnail,
            make_filmstrip,
            make_waveform,
            start_proxy,
            write_job_file,
            start_export,
            cancel_job,
            detect_silence,
            detect_scenes,
            analyze_focus,
            analyze_faces,
            files_exist,
            find_files_in_dir,
            read_text_file,
            write_text_file,
            db_list_projects,
            db_save_project,
            db_load_project,
            db_rename_project,
            db_duplicate_project,
            db_set_archived,
            db_set_folder,
            db_delete_project,
            db_add_backup,
            db_list_backups,
            db_get_backup,
            db_delete_backup,
            get_setting,
            set_setting,
            ai_status,
            ai_set_whisper_dir,
            ai_download_model,
            ai_delete_model,
            ai_cancel,
            ai_transcribe,
            ai_ollama_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running StudioX AI");
}
