use std::fs;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::types::HistoryEntry;

const MAX_ENTRIES: usize = 100;

/// Append-only JSONL history in the app-data dir. JSONL avoids rewriting
/// the whole file per entry and degrades gracefully if one line corrupts.
pub struct HistoryStore {
    path: PathBuf,
}

impl HistoryStore {
    pub fn load() -> AppResult<Self> {
        let dir = dirs::data_dir()
            .map(|d| d.join("voice-to-prompt"))
            .ok_or_else(|| AppError::Settings("cannot resolve data dir".into()))?;
        fs::create_dir_all(&dir)?;
        Ok(Self {
            path: dir.join("history.jsonl"),
        })
    }

    pub fn push(&self, entry: &HistoryEntry) -> AppResult<()> {
        use std::io::Write;
        let line = serde_json::to_string(entry).map_err(|e| AppError::Settings(e.to_string()))?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(f, "{line}")?;
        Ok(())
    }

    pub fn all(&self) -> Vec<HistoryEntry> {
        let mut out = Vec::new();
        if let Ok(raw) = fs::read_to_string(&self.path) {
            for line in raw.lines().rev() {
                if let Ok(e) = serde_json::from_str::<HistoryEntry>(line) {
                    out.push(e);
                }
                if out.len() >= MAX_ENTRIES {
                    break;
                }
            }
        }
        out
    }

    pub fn clear(&self) -> AppResult<()> {
        fs::write(&self.path, "")?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut entries = self.all();
        entries.retain(|e| e.id != id);
        entries.reverse();
        use std::io::Write;
        let mut f = fs::File::create(&self.path)?;
        for e in entries {
            let line =
                serde_json::to_string(&e).map_err(|err| AppError::Settings(err.to_string()))?;
            writeln!(f, "{line}")?;
        }
        Ok(())
    }
}

/// The transcript hint is the only thing kept from the request — the audio
/// itself is never persisted.
pub fn transcript_hint(response_text: &str) -> String {
    let mut hint = response_text.trim().chars().take(140).collect::<String>();
    if response_text.trim().chars().count() > 140 {
        hint.push('…');
    }
    hint
}

pub fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

pub fn now_iso() -> String {
    // RFC3339 without pulling in chrono: compute from Unix seconds.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3_600, (rem % 3_600) / 60, rem % 60);
    // civil-from-days (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_delete_removes_matching_entry() {
        let temp_dir = std::env::temp_dir().join(format!("vtp_test_{}", new_id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let store = HistoryStore {
            path: temp_dir.join("test_history.jsonl"),
        };
        let e1 = HistoryEntry {
            id: "id-1".into(),
            created_at: now_iso(),
            duration_ms: 1000,
            transcript_hint: "hint 1".into(),
            response_text: "resp 1".into(),
            model: "model-1".into(),
            status: "success".into(),
            error_message: None,
        };
        let e2 = HistoryEntry {
            id: "id-2".into(),
            created_at: now_iso(),
            duration_ms: 2000,
            transcript_hint: "hint 2".into(),
            response_text: "resp 2".into(),
            model: "model-2".into(),
            status: "success".into(),
            error_message: None,
        };
        store.push(&e1).unwrap();
        store.push(&e2).unwrap();
        assert_eq!(store.all().len(), 2);

        store.delete("id-1").unwrap();
        let remaining = store.all();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "id-2");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
