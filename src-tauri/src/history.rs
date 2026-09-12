use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::types::HistoryEntry;

const MAX_ENTRIES: usize = 100;
const COMPACT_AFTER_ENTRIES: usize = 1_000;
const COMPACT_TO_ENTRIES: usize = 500;
const UNKNOWN_ENTRY_COUNT: usize = usize::MAX;
static NEXT_HISTORY_ID: AtomicU64 = AtomicU64::new(0);

/// Append-only JSONL history in the app-data dir. JSONL avoids rewriting
/// the whole file per entry and degrades gracefully if one line corrupts.
pub struct HistoryStore {
    path: PathBuf,
    io_lock: Mutex<()>,
    entry_count: AtomicUsize,
}

impl HistoryStore {
    pub fn load() -> AppResult<Self> {
        let dir = dirs::data_dir()
            .map(|d| d.join("voice-to-prompt"))
            .ok_or_else(|| AppError::Settings("cannot resolve data dir".into()))?;
        fs::create_dir_all(&dir)?;
        Ok(Self {
            path: dir.join("history.jsonl"),
            io_lock: Mutex::new(()),
            entry_count: AtomicUsize::new(UNKNOWN_ENTRY_COUNT),
        })
    }

    pub fn push(&self, entry: &HistoryEntry) -> AppResult<()> {
        let _guard = self.io_lock.lock().unwrap();
        let line = serde_json::to_string(entry).map_err(|e| AppError::Settings(e.to_string()))?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(f, "{line}")?;
        let previous_count = self.entry_count.load(Ordering::Relaxed);
        if previous_count == UNKNOWN_ENTRY_COUNT {
            let count = self.compact_unlocked()?;
            self.entry_count.store(count, Ordering::Relaxed);
        } else {
            let count = previous_count.saturating_add(1);
            if count > COMPACT_AFTER_ENTRIES {
                let compacted = self.compact_unlocked()?;
                self.entry_count.store(compacted, Ordering::Relaxed);
            } else {
                self.entry_count.store(count, Ordering::Relaxed);
            }
        }
        Ok(())
    }

    fn compact_unlocked(&self) -> AppResult<usize> {
        let raw = match fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error.into()),
        };
        let count = raw.lines().count();
        if count <= COMPACT_AFTER_ENTRIES {
            return Ok(count);
        }
        let mut kept = raw
            .lines()
            .rev()
            .take(COMPACT_TO_ENTRIES)
            .collect::<Vec<_>>();
        kept.reverse();
        let tmp = self.path.with_extension("jsonl.tmp");
        let mut output = fs::File::create(&tmp)?;
        for line in kept {
            writeln!(output, "{line}")?;
        }
        output.flush()?;
        fs::rename(tmp, &self.path)?;
        Ok(COMPACT_TO_ENTRIES)
    }

    pub fn all(&self) -> AppResult<Vec<HistoryEntry>> {
        let _guard = self.io_lock.lock().unwrap();
        self.all_unlocked(MAX_ENTRIES)
    }

    fn all_unlocked(&self, limit: usize) -> AppResult<Vec<HistoryEntry>> {
        let mut out = Vec::new();
        if !self.path.exists() {
            return Ok(out);
        }
        let raw = fs::read_to_string(&self.path)?;
        for line in raw.lines().rev() {
            if let Ok(e) = serde_json::from_str::<HistoryEntry>(line) {
                out.push(e);
            }
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    pub fn clear(&self) -> AppResult<()> {
        let _guard = self.io_lock.lock().unwrap();
        fs::write(&self.path, "")?;
        self.entry_count.store(0, Ordering::Relaxed);
        Ok(())
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let _guard = self.io_lock.lock().unwrap();
        if !self.path.exists() {
            return Ok(());
        }
        let tmp = self.path.with_extension("jsonl.tmp");
        let input = fs::File::open(&self.path)?;
        let mut output = fs::File::create(&tmp)?;
        let mut kept_count = 0usize;
        for line in BufReader::new(input).lines() {
            let line = line?;
            let remove = serde_json::from_str::<HistoryEntry>(&line)
                .map(|entry| entry.id == id)
                .unwrap_or(false);
            if !remove {
                writeln!(output, "{line}")?;
                kept_count = kept_count.saturating_add(1);
            }
        }
        output.flush()?;
        fs::rename(tmp, &self.path)?;
        self.entry_count.store(kept_count, Ordering::Relaxed);
        Ok(())
    }
}

/// The transcript hint is the only thing kept from the request — the audio
/// itself is never persisted. Keep the full transcript so history search and
/// review do not lose words after an arbitrary character limit.
pub fn transcript_hint(transcript: &str) -> String {
    transcript.trim().to_string()
}

pub fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let sequence = NEXT_HISTORY_ID.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{sequence:x}")
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
            io_lock: Mutex::new(()),
            entry_count: AtomicUsize::new(UNKNOWN_ENTRY_COUNT),
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
        assert_eq!(store.all().unwrap().len(), 2);

        store.delete("id-1").unwrap();
        let remaining = store.all().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "id-2");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn transcript_hint_preserves_long_transcripts() {
        let transcript = format!("{} kết thúc", "từ ".repeat(60));

        let hint = transcript_hint(&transcript);

        assert_eq!(hint, transcript.trim());
        assert!(hint.chars().count() > 140);
        assert!(!hint.ends_with('…'));
    }

    #[test]
    fn new_id_is_unique_across_concurrent_calls() {
        use std::collections::HashSet;
        use std::sync::{Arc, Barrier};

        const THREADS: usize = 8;
        const IDS_PER_THREAD: usize = 2_000;
        let barrier = Arc::new(Barrier::new(THREADS));
        let mut workers = Vec::with_capacity(THREADS);

        for _ in 0..THREADS {
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                (0..IDS_PER_THREAD).map(|_| new_id()).collect::<Vec<_>>()
            }));
        }

        let ids = workers
            .into_iter()
            .flat_map(|worker| worker.join().expect("id worker"))
            .collect::<Vec<_>>();
        let unique = ids.iter().collect::<HashSet<_>>();

        assert_eq!(unique.len(), ids.len());
    }

    #[test]
    fn history_read_errors_are_returned_to_the_caller() {
        let temp_dir = std::env::temp_dir().join(format!("vtp_history_dir_{}", new_id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let store = HistoryStore {
            path: temp_dir.clone(),
            io_lock: Mutex::new(()),
            entry_count: AtomicUsize::new(UNKNOWN_ENTRY_COUNT),
        };

        assert!(store.all().is_err());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn deleting_one_entry_preserves_entries_beyond_the_visible_limit() {
        let temp_dir = std::env::temp_dir().join(format!("vtp_test_{}", new_id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("test_history.jsonl");
        let store = HistoryStore {
            path: path.clone(),
            io_lock: Mutex::new(()),
            entry_count: AtomicUsize::new(UNKNOWN_ENTRY_COUNT),
        };
        for index in 0..105 {
            store
                .push(&HistoryEntry {
                    id: format!("id-{index}"),
                    created_at: now_iso(),
                    duration_ms: index,
                    transcript_hint: String::new(),
                    response_text: format!("resp {index}"),
                    model: "model".into(),
                    status: "success".into(),
                    error_message: None,
                })
                .unwrap();
        }

        store.delete("id-104").unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert_eq!(raw.lines().count(), 104);
        assert!(raw.contains("\"id\":\"id-0\""));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn compaction_only_runs_after_threshold_and_keeps_newest_entries() {
        let temp_dir = std::env::temp_dir().join(format!("vtp_test_{}", new_id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let path = temp_dir.join("test_history.jsonl");
        let store = HistoryStore {
            path: path.clone(),
            io_lock: Mutex::new(()),
            entry_count: AtomicUsize::new(UNKNOWN_ENTRY_COUNT),
        };
        for index in 0..=COMPACT_AFTER_ENTRIES {
            store
                .push(&HistoryEntry {
                    id: format!("id-{index}"),
                    created_at: now_iso(),
                    duration_ms: index as u64,
                    transcript_hint: String::new(),
                    response_text: format!("resp {index}"),
                    model: "model".into(),
                    status: "success".into(),
                    error_message: None,
                })
                .unwrap();
        }
        let raw = fs::read_to_string(&path).unwrap();
        assert_eq!(raw.lines().count(), COMPACT_TO_ENTRIES);
        assert!(!raw.contains("\"id\":\"id-0\""));
        assert!(raw.contains(&format!("\"id\":\"id-{}\"", COMPACT_AFTER_ENTRIES)));
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
