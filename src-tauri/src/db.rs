//! SQLite persistence: projects, folders, archive, backups / version history, settings.

use crate::error::{msg, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db {
    conn: Mutex<Connection>,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub thumbnail: Option<String>,
    pub duration: f64,
    pub width: i64,
    pub height: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMeta {
    pub id: i64,
    pub project_id: String,
    pub created_at: i64,
    pub label: String,
    pub kind: String,
    pub size: i64,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  opened_at INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,
  duration REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backups(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'auto',
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_project ON backups(project_id, created_at);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(
  path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  kind TEXT NOT NULL,
  probe TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
"#;

fn meta_of(data: &Value) -> (f64, i64, i64) {
    let w = data["settings"]["width"].as_i64().unwrap_or(0);
    let h = data["settings"]["height"].as_i64().unwrap_or(0);
    let mut dur = 0.0f64;
    if let Some(clips) = data["clips"].as_object() {
        for c in clips.values() {
            let e = c["start"].as_f64().unwrap_or(0.0) + c["duration"].as_f64().unwrap_or(0.0);
            dur = dur.max(e);
        }
    }
    (dur, w, h)
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Db> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn list_projects(&self) -> AppResult<Vec<ProjectMeta>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(
            "SELECT id,name,folder,archived,created_at,updated_at,thumbnail,duration,width,height FROM projects ORDER BY MAX(updated_at, opened_at) DESC",
        )?;
        let rows = st.query_map([], |r| {
            Ok(ProjectMeta {
                id: r.get(0)?,
                name: r.get(1)?,
                folder: r.get(2)?,
                archived: r.get::<_, i64>(3)? != 0,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
                thumbnail: r.get(6)?,
                duration: r.get(7)?,
                width: r.get(8)?,
                height: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Insert or update a project document.
    pub fn save_project(&self, data: &str, thumbnail: Option<String>) -> AppResult<i64> {
        let v: Value = serde_json::from_str(data)?;
        let id = v["id"].as_str().ok_or_else(|| crate::error::AppError::Msg("Project has no id".into()))?;
        let name = v["name"].as_str().unwrap_or("Untitled");
        let (dur, w, h) = meta_of(&v);
        let t = now_ms();
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO projects(id,name,created_at,updated_at,thumbnail,duration,width,height,data) VALUES(?1,?2,?3,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at,
               thumbnail=COALESCE(excluded.thumbnail, projects.thumbnail), duration=excluded.duration,
               width=excluded.width, height=excluded.height, data=excluded.data",
            params![id, name, t, thumbnail, dur, w, h, data],
        )?;
        Ok(t)
    }

    pub fn load_project(&self, id: &str) -> AppResult<String> {
        let c = self.conn.lock().unwrap();
        c.execute("UPDATE projects SET opened_at=?2 WHERE id=?1", params![id, now_ms()])?;
        let d: Option<String> = c.query_row("SELECT data FROM projects WHERE id=?1", [id], |r| r.get(0)).optional()?;
        d.ok_or_else(|| crate::error::AppError::Msg("Project not found".into()))
    }

    fn update_json(&self, id: &str, f: impl FnOnce(&mut Value)) -> AppResult<()> {
        let data = self.load_project(id)?;
        let mut v: Value = serde_json::from_str(&data)?;
        f(&mut v);
        self.save_project(&serde_json::to_string(&v)?, None)?;
        Ok(())
    }

    pub fn rename_project(&self, id: &str, name: &str) -> AppResult<()> {
        if name.trim().is_empty() {
            return msg("Name cannot be empty");
        }
        self.update_json(id, |v| v["name"] = Value::String(name.trim().to_string()))
    }

    pub fn duplicate_project(&self, id: &str, new_id: &str, new_name: &str) -> AppResult<()> {
        let data = self.load_project(id)?;
        let mut v: Value = serde_json::from_str(&data)?;
        v["id"] = Value::String(new_id.into());
        v["name"] = Value::String(new_name.into());
        let thumb: Option<String> = {
            let c = self.conn.lock().unwrap();
            c.query_row("SELECT thumbnail FROM projects WHERE id=?1", [id], |r| r.get(0)).optional()?.flatten()
        };
        self.save_project(&serde_json::to_string(&v)?, thumb)?;
        let folder: String = {
            let c = self.conn.lock().unwrap();
            c.query_row("SELECT folder FROM projects WHERE id=?1", [id], |r| r.get(0))?
        };
        self.set_folder(new_id, &folder)
    }

    pub fn set_archived(&self, id: &str, archived: bool) -> AppResult<()> {
        self.conn.lock().unwrap().execute("UPDATE projects SET archived=?2 WHERE id=?1", params![id, archived as i64])?;
        Ok(())
    }

    pub fn set_folder(&self, id: &str, folder: &str) -> AppResult<()> {
        self.conn.lock().unwrap().execute("UPDATE projects SET folder=?2 WHERE id=?1", params![id, folder.trim()])?;
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> AppResult<()> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM backups WHERE project_id=?1", [id])?;
        c.execute("DELETE FROM projects WHERE id=?1", [id])?;
        Ok(())
    }

    // ------------------------------------------------------------ backups / versions

    pub fn add_backup(&self, project_id: &str, label: &str, kind: &str, data: &str) -> AppResult<i64> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO backups(project_id,created_at,label,kind,data) VALUES(?1,?2,?3,?4,?5)",
            params![project_id, now_ms(), label, kind, data],
        )?;
        let id = c.last_insert_rowid();
        // keep the 30 most recent automatic backups
        c.execute(
            "DELETE FROM backups WHERE project_id=?1 AND kind='auto' AND id NOT IN
             (SELECT id FROM backups WHERE project_id=?1 AND kind='auto' ORDER BY created_at DESC LIMIT 30)",
            [project_id],
        )?;
        Ok(id)
    }

    pub fn list_backups(&self, project_id: &str) -> AppResult<Vec<BackupMeta>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(
            "SELECT id,project_id,created_at,label,kind,length(data) FROM backups WHERE project_id=?1 ORDER BY created_at DESC",
        )?;
        let rows = st.query_map([project_id], |r| {
            Ok(BackupMeta {
                id: r.get(0)?,
                project_id: r.get(1)?,
                created_at: r.get(2)?,
                label: r.get(3)?,
                kind: r.get(4)?,
                size: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_backup(&self, id: i64) -> AppResult<String> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT data FROM backups WHERE id=?1", [id], |r| r.get(0))?)
    }

    pub fn delete_backup(&self, id: i64) -> AppResult<()> {
        self.conn.lock().unwrap().execute("DELETE FROM backups WHERE id=?1", [id])?;
        Ok(())
    }

    // ------------------------------------------------------------ settings & asset index

    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn cached_probe(&self, path: &str, size: u64, mtime: u64) -> AppResult<Option<String>> {
        let c = self.conn.lock().unwrap();
        Ok(c
            .query_row(
                "SELECT probe FROM assets WHERE path=?1 AND size=?2 AND mtime=?3",
                params![path, size as i64, mtime as i64],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn store_probe(&self, path: &str, size: u64, mtime: u64, kind: &str, probe: &str) -> AppResult<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO assets(path,size,mtime,kind,probe,indexed_at) VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, kind=excluded.kind, probe=excluded.probe, indexed_at=excluded.indexed_at",
            params![path, size as i64, mtime as i64, kind, probe, now_ms()],
        )?;
        Ok(())
    }
}
