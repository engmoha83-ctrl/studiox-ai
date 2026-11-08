//! Loopback HTTP media server with HTTP Range support.
//!
//! WebViews decode <video>/<audio> most reliably over http(s): WebKitGTK cannot
//! play media from custom URI schemes at all, and range requests behave the same
//! on WebView2 / WKWebView. The server binds 127.0.0.1 on a random port and every
//! URL carries a random per-session token, so other local processes or web pages
//! cannot read files through it.

use std::collections::hash_map::RandomState;
use std::fs::File;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

pub struct MediaServer {
    pub base_url: String,
}

fn random_token() -> String {
    let mut s = String::new();
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i ^ std::process::id() as u64);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn respond_status(s: &mut TcpStream, code: u16, text: &str) {
    let _ = write!(s, "HTTP/1.1 {code} {text}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n");
}

fn handle(mut stream: TcpStream, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut range: Option<(u64, Option<u64>)> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
            break;
        }
        let l = line.to_ascii_lowercase();
        if let Some(v) = l.strip_prefix("range:") {
            if let Some(r) = v.trim().strip_prefix("bytes=") {
                let mut it = r.splitn(2, '-');
                let a = it.next().and_then(|x| x.trim().parse().ok());
                let b = it.next().and_then(|x| x.trim().parse().ok());
                if let Some(a) = a {
                    range = Some((a, b));
                }
            }
        }
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method != "GET" && method != "HEAD" {
        return respond_status(&mut stream, 405, "Method Not Allowed");
    }
    let prefix = format!("/{token}/");
    let Some(enc) = target.strip_prefix(&prefix) else {
        return respond_status(&mut stream, 403, "Forbidden");
    };
    let enc = enc.split('?').next().unwrap_or("");
    let Some(path) = percent_decode(enc) else {
        return respond_status(&mut stream, 400, "Bad Request");
    };
    let p = PathBuf::from(&path);
    let Ok(mut file) = File::open(&p) else {
        return respond_status(&mut stream, 404, "Not Found");
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let (start, end, partial) = match range {
        Some((a, b)) if a < len => (a, b.unwrap_or(len - 1).min(len - 1), true),
        Some(_) => {
            let _ = write!(stream, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return;
        }
        None => (0, len.saturating_sub(1), false),
    };
    let count = if len == 0 { 0 } else { end - start + 1 };
    let head = if partial {
        format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {count}\r\nContent-Range: bytes {start}-{end}/{len}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            mime(&path)
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {count}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            mime(&path)
        )
    };
    if stream.write_all(head.as_bytes()).is_err() || method == "HEAD" {
        return;
    }
    if file.seek(SeekFrom::Start(start)).is_err() {
        return;
    }
    let mut remaining = count;
    let mut buf = vec![0u8; 256 * 1024];
    while remaining > 0 {
        let n = (remaining as usize).min(buf.len());
        match file.read(&mut buf[..n]) {
            Ok(0) | Err(_) => break,
            Ok(k) => {
                if stream.write_all(&buf[..k]).is_err() {
                    break; // client aborted (seek) – normal
                }
                remaining -= k as u64;
            }
        }
    }
}

pub fn start() -> std::io::Result<MediaServer> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let token = random_token();
    let t2 = token.clone();
    std::thread::spawn(move || {
        for s in listener.incoming().flatten() {
            let tk = t2.clone();
            std::thread::spawn(move || handle(s, &tk));
        }
    });
    Ok(MediaServer { base_url: format!("http://127.0.0.1:{port}/{token}/") })
}
