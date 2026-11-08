//! File helpers: existence checks (missing media), relink search, text file IO.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub fn exists_many(paths: &[String]) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

/// Search `dir` recursively (bounded depth / count) for files whose names are in `names`.
pub fn find_by_name(dir: &Path, names: &[String], max_depth: usize) -> HashMap<String, String> {
    let wanted: HashMap<String, String> = names.iter().map(|n| (n.to_lowercase(), n.clone())).collect();
    let mut found = HashMap::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(dir.to_path_buf(), 0)];
    let mut visited = 0usize;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            visited += 1;
            if visited > 200_000 || found.len() == wanted.len() {
                return found;
            }
            let p = e.path();
            if p.is_dir() {
                if depth < max_depth {
                    stack.push((p, depth + 1));
                }
            } else if let Some(n) = p.file_name().map(|n| n.to_string_lossy().to_lowercase()) {
                if let Some(orig) = wanted.get(&n) {
                    found.entry(orig.clone()).or_insert_with(|| p.to_string_lossy().to_string());
                }
            }
        }
    }
    found
}
