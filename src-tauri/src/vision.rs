// Local computer vision: face detection with YuNet (MIT licence, OpenCV Zoo, 230 KB, embedded
// in the binary) running on tract (pure-Rust ONNX inference – no external runtime to install).
use crate::error::{msg, AppError, AppResult};
use crate::ffmpeg::{command, Ffmpeg};
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tract_onnx::prelude::*;

const YUNET: &[u8] = include_bytes!("../models/face_detection_yunet_2023mar.onnx");
const SIDE: usize = 640;

type Plan = TypedRunnableModel;
static MODEL: OnceLock<Result<Arc<Plan>, String>> = OnceLock::new();

fn model() -> AppResult<Arc<Plan>> {
    MODEL
        .get_or_init(|| {
            let load = || -> TractResult<Arc<Plan>> {
                tract_onnx::onnx()
                    .model_for_read(&mut std::io::Cursor::new(YUNET))?
                    .with_input_fact(0, f32::fact([1, 3, SIDE, SIDE]).into())?
                    .into_optimized()?
                    .into_runnable()
            };
            load().map_err(|e| format!("face model failed to load: {e}"))
        })
        .clone()
        .map_err(AppError::Msg)
}

/// Face box in fractions (0..1) of the analysed frame.
#[derive(Serialize, Clone, Debug)]
pub struct Face {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub score: f32,
}

#[derive(Serialize, Debug)]
pub struct FaceFrame {
    /// seconds from the analysed range start (source time)
    pub t: f64,
    pub faces: Vec<Face>,
}

fn iou(a: &Face, b: &Face) -> f32 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.w).min(b.x + b.w);
    let y2 = (a.y + a.h).min(b.y + b.h);
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    inter / (a.w * a.h + b.w * b.h - inter).max(1e-9)
}

/// Run YuNet on a 640×640 BGR image (`content_w`×`content_h` is the real picture in its top-left
/// corner, the rest is padding). Returns boxes as fractions of the content area.
pub fn detect(bgr: &[u8], content_w: usize, content_h: usize, threshold: f32) -> AppResult<Vec<Face>> {
    let plan = model()?;
    let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, SIDE, SIDE));
    for y in 0..SIDE {
        for x in 0..SIDE {
            let i = (y * SIDE + x) * 3;
            for c in 0..3 {
                input[[0, c, y, x]] = bgr[i + c] as f32;
            }
        }
    }
    let out = plan.run(tvec!(Tensor::from(input).into())).map_err(|e| AppError::Msg(format!("face detection failed: {e}")))?;
    // outputs: cls_8,16,32 · obj_8,16,32 · bbox_8,16,32 · kps_8,16,32
    let view = |i: usize| out[i].to_plain_array_view::<f32>().map(|v| v.iter().copied().collect::<Vec<f32>>());
    let mut faces = vec![];
    for (k, stride) in [8usize, 16, 32].into_iter().enumerate() {
        let (cls, obj, bbox) = match (view(k), view(3 + k), view(6 + k)) {
            (Ok(a), Ok(b), Ok(c)) => (a, b, c),
            _ => return msg("unexpected face model output"),
        };
        let cols = SIDE / stride;
        for (idx, (&c, &o)) in cls.iter().zip(obj.iter()).enumerate() {
            let score = (c.clamp(0.0, 1.0) * o.clamp(0.0, 1.0)).sqrt();
            if score < threshold {
                continue;
            }
            let (r, col) = (idx / cols, idx % cols);
            let b = &bbox[idx * 4..idx * 4 + 4];
            let cx = (col as f32 + b[0]) * stride as f32;
            let cy = (r as f32 + b[1]) * stride as f32;
            let w = b[2].exp() * stride as f32;
            let h = b[3].exp() * stride as f32;
            faces.push(Face { x: (cx - w / 2.0) / content_w as f32, y: (cy - h / 2.0) / content_h as f32, w: w / content_w as f32, h: h / content_h as f32, score });
        }
    }
    // non-maximum suppression
    faces.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    let mut keep: Vec<Face> = vec![];
    for f in faces {
        if keep.iter().all(|k| iou(k, &f) < 0.3) {
            keep.push(f);
        }
    }
    keep.retain(|f| f.x + f.w > 0.0 && f.y + f.h > 0.0 && f.x < 1.0 && f.y < 1.0);
    Ok(keep)
}

/// Decode `duration` seconds from `start` at `rate` fps, letter-boxed into 640×640, and detect faces.
pub fn analyze_faces(ff: &Ffmpeg, path: &Path, start: f64, duration: f64, rate: f64, cancel: Option<Arc<AtomicBool>>, mut progress: impl FnMut(f64)) -> AppResult<Vec<FaceFrame>> {
    // content size: longest side 640, even dimensions
    let probe = crate::ffmpeg::probe(ff, path)?;
    let (sw, sh) = (probe.width.max(1) as f64, probe.height.max(1) as f64);
    let k = SIDE as f64 / sw.max(sh);
    let cw = (((sw * k) / 2.0).floor() * 2.0).max(2.0) as usize;
    let ch = (((sh * k) / 2.0).floor() * 2.0).max(2.0) as usize;
    let vf = format!("fps={rate}:round=up,scale={cw}:{ch}:flags=bilinear,pad={SIDE}:{SIDE}:0:0:black,format=bgr24");
    let mut child = command(&ff.ffmpeg()?)
        .args(["-hide_banner", "-loglevel", "error", "-ss", &format!("{start:.3}"), "-t", &format!("{duration:.3}"), "-i"])
        .arg(path)
        .args(["-an", "-vf", &vf, "-f", "rawvideo", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut out = child.stdout.take().unwrap();
    let mut frame = vec![0u8; SIDE * SIDE * 3];
    let total = (duration * rate).ceil().max(1.0);
    let mut res = vec![];
    let mut i = 0usize;
    while out.read_exact(&mut frame).is_ok() {
        if cancel.as_ref().is_some_and(|c| c.load(Ordering::SeqCst)) {
            let _ = child.kill();
            return msg("cancelled");
        }
        let faces = detect(&frame, cw, ch, 0.6)?;
        res.push(FaceFrame { t: i as f64 / rate, faces });
        i += 1;
        progress((i as f64 / total).min(1.0));
    }
    let _ = child.wait();
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(path: &str) -> Option<(Vec<u8>, usize, usize)> {
        // decode any image with ffmpeg into the 640×640 letter-box the model expects
        let p = Path::new(path);
        if !p.is_file() {
            return None;
        }
        let ff = Ffmpeg { ffmpeg: Some("ffmpeg".into()), ffprobe: Some("ffprobe".into()), ..Default::default() };
        let pr = crate::ffmpeg::probe(&ff, p).ok()?;
        let k = SIDE as f64 / (pr.width.max(pr.height) as f64);
        let cw = (((pr.width as f64 * k) / 2.0).floor() * 2.0) as usize;
        let ch = (((pr.height as f64 * k) / 2.0).floor() * 2.0) as usize;
        let out = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-i", path, "-vf", &format!("scale={cw}:{ch},pad={SIDE}:{SIDE}:0:0:black,format=bgr24"), "-frames:v", "1", "-f", "rawvideo", "-"])
            .output()
            .ok()?;
        Some((out.stdout, cw, ch))
    }

    /// Reference values from OpenCV's FaceDetectorYN on the same model (see docs/TESTING_REPORT.md).
    #[test]
    fn detects_faces_like_opencv() {
        let Some((img, cw, ch)) = load(&std::env::var("STUDIOX_FACE_FIXTURE").unwrap_or_else(|_| "/tmp/dl/lena.jpg".into())) else {
            eprintln!("fixture/ffmpeg missing – skipped");
            return;
        };
        let f = detect(&img, cw, ch, 0.6).unwrap();
        assert_eq!(f.len(), 1, "{f:?}");
        // OpenCV: x=208 y=183 w=146 h=207 on 512×512
        let (x, y, w, h) = (f[0].x * 512.0, f[0].y * 512.0, f[0].w * 512.0, f[0].h * 512.0);
        assert!((x - 208.0).abs() < 6.0 && (y - 183.0).abs() < 6.0 && (w - 146.0).abs() < 8.0 && (h - 207.0).abs() < 8.0, "{x} {y} {w} {h}");
    }

    /// A face moving across a 1280×720 video is found in every sampled frame, at the right place.
    #[test]
    fn tracks_a_face_across_a_video() {
        let img = std::env::var("STUDIOX_FACE_FIXTURE").unwrap_or_else(|_| "/tmp/dl/lena.jpg".into());
        if !Path::new(&img).is_file() {
            eprintln!("fixture missing – skipped");
            return;
        }
        let dir = std::env::temp_dir().join(format!("studiox-faces-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("face.mp4");
        // 300×300 portrait, x = 100 + 200·t, over 4 s
        let ok = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404040:s=1280x720:r=25:d=4", "-loop", "1", "-i", &img])
            .args(["-filter_complex", "[1]scale=300:300[f];[0][f]overlay=x='100+200*t':y=200:shortest=1,format=yuv420p"])
            .arg(&clip)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            return;
        }
        let ff = Ffmpeg { ffmpeg: Some("ffmpeg".into()), ffprobe: Some("ffprobe".into()), ..Default::default() };
        let t0 = std::time::Instant::now();
        let frames = analyze_faces(&ff, &clip, 0.0, 4.0, 2.0, None, |_| {}).unwrap();
        eprintln!("{} frames in {:?}", frames.len(), t0.elapsed());
        assert!(frames.len() >= 7);
        for f in &frames {
            assert_eq!(f.faces.len(), 1, "t={} {:?}", f.t, f.faces);
            let cx = (f.faces[0].x + f.faces[0].w / 2.0) * 1280.0;
            // the face centre in the 512² test portrait is at x ≈ 0.55 (OpenCV reference)
            let expect = 100.0 + 200.0 * f.t as f32 + 0.55 * 300.0;
            assert!((cx - expect).abs() < 30.0, "t={} cx={cx} expect={expect}", f.t);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_faces_in_a_flat_image() {
        let img = vec![60u8; SIDE * SIDE * 3];
        assert!(detect(&img, SIDE, SIDE, 0.6).unwrap().is_empty());
    }
}
