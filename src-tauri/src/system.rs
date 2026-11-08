//! Hardware detection → performance profile (Low / Balanced / High).

use crate::ffmpeg::command;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use sysinfo::{Disks, System};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vram_mb: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpu: String,
    pub cpu_cores: usize,
    pub cpu_threads: usize,
    pub ram_mb: u64,
    pub gpus: Vec<GpuInfo>,
    pub disk_free_mb: u64,
    pub disk_total_mb: u64,
    pub profile: String,
}

fn detect_gpus() -> Vec<GpuInfo> {
    let mut gpus = vec![];
    if cfg!(windows) {
        let out = command(&PathBuf::from("powershell"))
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        if let Ok(o) = out {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&o.stdout) {
                let arr = if v.is_array() { v.as_array().cloned().unwrap_or_default() } else { vec![v] };
                for g in arr {
                    if let Some(n) = g["Name"].as_str() {
                        // AdapterRAM is a 32-bit field (caps at 4 GB) – reported as a lower bound.
                        let vram = g["AdapterRAM"].as_u64().map(|b| b / 1024 / 1024).filter(|m| *m > 0);
                        gpus.push(GpuInfo { name: n.to_string(), vram_mb: vram });
                    }
                }
            }
        }
    } else if cfg!(target_os = "macos") {
        let out = command(&PathBuf::from("system_profiler")).args(["SPDisplaysDataType", "-json"]).stdout(Stdio::piped()).output();
        if let Ok(o) = out {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&o.stdout) {
                for g in v["SPDisplaysDataType"].as_array().cloned().unwrap_or_default() {
                    if let Some(n) = g["sppci_model"].as_str() {
                        gpus.push(GpuInfo { name: n.to_string(), vram_mb: None });
                    }
                }
            }
        }
    } else {
        let out = command(&PathBuf::from("lspci")).stdout(Stdio::piped()).stderr(Stdio::null()).output();
        if let Ok(o) = out {
            for l in String::from_utf8_lossy(&o.stdout).lines() {
                if l.contains("VGA") || l.contains("3D controller") || l.contains("Display controller") {
                    let name = l.splitn(2, ": ").nth(1).unwrap_or(l).to_string();
                    gpus.push(GpuInfo { name, vram_mb: None });
                }
            }
        }
    }
    gpus
}

fn is_discrete(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("nvidia") || n.contains("geforce") || n.contains("rtx") || n.contains("quadro") || n.contains("radeon rx")
        || n.contains("radeon pro") || n.contains("arc a") || n.contains("apple m")
}

pub fn detect(data_dir: &Path) -> SystemInfo {
    let (cpu, threads, ram_mb) = match System::new() {
        Ok(mut sys) => {
            sys.refresh_memory();
            sys.refresh_cpu_all();
            let cpus = sys.cpus();
            (cpus.first().map(|c| c.brand().trim().to_string()).unwrap_or_default(), cpus.len(), sys.total_memory() / 1024 / 1024)
        }
        Err(_) => (String::new(), std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1), 0),
    };
    let cores = System::physical_core_count().ok().unwrap_or(threads).max(1);
    let mut best: Option<(usize, u64, u64)> = None;
    let disks = Disks::new_with_refreshed_list().map(|d| d.iter().map(|d| (d.mount_point().to_path_buf(), d.available_space(), d.total_space())).collect::<Vec<_>>()).unwrap_or_default();
    for (mp, avail, total) in disks {
        if data_dir.starts_with(&mp) {
            let len = mp.as_os_str().len();
            if best.map(|b| len > b.0).unwrap_or(true) {
                best = Some((len, avail, total));
            }
        }
    }
    let (free, total) = best.map(|b| (b.1, b.2)).unwrap_or((0, 0));
    let gpus = detect_gpus();
    let discrete = gpus.iter().any(|g| is_discrete(&g.name));
    let profile = if ram_mb < 7_500 || cores < 4 {
        "low"
    } else if ram_mb >= 15_500 && cores >= 8 && discrete {
        "high"
    } else {
        "balanced"
    };
    SystemInfo {
        os: System::name().ok().unwrap_or_else(|| std::env::consts::OS.into()),
        os_version: System::long_os_version().ok().or_else(|| System::os_version().ok()).unwrap_or_default(),
        arch: std::env::consts::ARCH.into(),
        cpu,
        cpu_cores: cores,
        cpu_threads: threads,
        ram_mb,
        gpus,
        disk_free_mb: free / 1024 / 1024,
        disk_total_mb: total / 1024 / 1024,
        profile: profile.into(),
    }
}
