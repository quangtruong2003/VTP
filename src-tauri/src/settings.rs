use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::types::AppSettings;

const SERVICE: &str = "com.voicetoprompt.app";
const KEY_ENTRY: &str = "gemini-api-key";

fn read_settings_file(path: &std::path::Path) -> AppResult<AppSettings> {
    if path.exists() {
        let raw = fs::read_to_string(path)?;
        let mut settings: AppSettings =
            serde_json::from_str(&raw).map_err(|e| AppError::Settings(e.to_string()))?;
        let mut migrated = false;
        if settings
            .process_shortcut
            .trim()
            .eq_ignore_ascii_case("enter")
        {
            settings.process_shortcut.clear();
            migrated = true;
        }
        if migrated {
            let json = serde_json::to_string_pretty(&settings)
                .map_err(|e| AppError::Settings(e.to_string()))?;
            fs::write(path, json)?;
        }
        Ok(settings)
    } else {
        Ok(AppSettings::default())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ApiKeyCache {
    Unloaded,
    Missing,
    Present(Vec<String>),
}

fn get_cached_api_keys<F>(cache: &Mutex<ApiKeyCache>, load: F) -> AppResult<Vec<String>>
where
    F: FnOnce() -> AppResult<Vec<String>>,
{
    let mut guard = cache.lock().unwrap();
    match &*guard {
        ApiKeyCache::Present(keys) => return Ok(keys.clone()),
        ApiKeyCache::Missing => return Err(AppError::MissingApiKey),
        ApiKeyCache::Unloaded => {}
    }

    let keys = load()?;
    if keys.is_empty() {
        *guard = ApiKeyCache::Missing;
        return Err(AppError::MissingApiKey);
    }
    *guard = ApiKeyCache::Present(keys.clone());
    Ok(keys)
}

fn api_key_set_cached<F>(cache: &Mutex<ApiKeyCache>, load: F) -> bool
where
    F: FnOnce() -> AppResult<Vec<String>>,
{
    get_cached_api_keys(cache, load)
        .map(|keys| !keys.is_empty())
        .unwrap_or(false)
}

fn mutate_cached_api_keys<L, P>(
    cache: &Mutex<ApiKeyCache>,
    load: L,
    persist: P,
    update: impl FnOnce(&mut Vec<String>),
) -> AppResult<Vec<String>>
where
    L: FnOnce() -> AppResult<Vec<String>>,
    P: FnOnce(&[String]) -> AppResult<()>,
{
    let mut guard = cache.lock().unwrap();
    let (current, fresh) = match &*guard {
        ApiKeyCache::Present(keys) => (keys.clone(), false),
        ApiKeyCache::Missing => (Vec::new(), false),
        ApiKeyCache::Unloaded => (load()?, true),
    };
    let mut updated = current.clone();
    update(&mut updated);
    if fresh || updated != current {
        if updated != current {
            persist(&updated)?;
        }
        *guard = if updated.is_empty() {
            ApiKeyCache::Missing
        } else {
            ApiKeyCache::Present(updated.clone())
        };
    }
    Ok(updated)
}

/// The keyring holds a JSON array of keys, oldest... first entry is primary.
/// A bare string is a legacy single-key entry and migrates to a one-element
/// list on read.
fn parse_stored_api_keys(stored: &str) -> Vec<String> {
    if let Ok(keys) = serde_json::from_str::<Vec<String>>(stored.trim()) {
        keys.into_iter()
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty())
            .collect()
    } else {
        let trimmed = stored.trim();
        if trimmed.is_empty() {
            Vec::new()
        } else {
            vec![trimmed.to_string()]
        }
    }
}

/// All persisted state: non-secret settings in settings.json (in the OS
/// app-data dir), the API key exclusively in the OS credential store
/// (Windows Credential Manager / macOS Keychain via the `keyring` crate).
pub struct SettingsStore {
    path: PathBuf,
    settings: Mutex<AppSettings>,
    api_key_cache: Mutex<ApiKeyCache>,
    shortcut_changes: Mutex<()>,
}

impl SettingsStore {
    pub fn load() -> AppResult<Self> {
        let dir = dirs::data_dir()
            .map(|d| d.join("voice-to-prompt"))
            .ok_or_else(|| AppError::Settings("cannot resolve data dir".into()))?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("settings.json");
        let settings = read_settings_file(&path)?;
        Ok(Self {
            path,
            settings: Mutex::new(settings),
            api_key_cache: Mutex::new(ApiKeyCache::Unloaded),
            shortcut_changes: Mutex::new(()),
        })
    }

    pub fn lock_shortcut_changes(&self) -> std::sync::MutexGuard<'_, ()> {
        self.shortcut_changes.lock().unwrap()
    }

    pub fn get(&self) -> AppSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update<F: FnOnce(&mut AppSettings)>(&self, f: F) -> AppResult<AppSettings> {
        let mut guard = self.settings.lock().unwrap();
        let mut candidate = guard.clone();
        f(&mut candidate);
        let json = serde_json::to_string_pretty(&candidate)
            .map_err(|e| AppError::Settings(e.to_string()))?;
        // Persist the candidate first; only publish it in memory after the
        // atomic file replacement succeeds so callers can safely roll back
        // native registrations when persistence fails.
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, &self.path)?;
        *guard = candidate.clone();
        Ok(candidate)
    }

    // ---- API keys (OS credential store only, ordered list, first is primary) ----

    fn keyring_entry() -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, KEY_ENTRY)
    }

    fn load_api_keys_from_keyring() -> AppResult<Vec<String>> {
        let entry = Self::keyring_entry()?;
        match entry.get_password() {
            Ok(stored) => Ok(parse_stored_api_keys(&stored)),
            Err(keyring::Error::NoEntry) => Ok(Vec::new()),
            Err(error) => Err(AppError::from(error)),
        }
    }

    fn persist_api_keys(keys: &[String]) -> AppResult<()> {
        let entry = Self::keyring_entry()?;
        if keys.is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(AppError::from(error)),
            }
        } else {
            let raw =
                serde_json::to_string(keys).map_err(|e| AppError::Keyring(e.to_string()))?;
            entry.set_password(&raw).map_err(AppError::from)
        }
    }

    fn mutate_keys(&self, update: impl FnOnce(&mut Vec<String>)) -> AppResult<Vec<String>> {
        mutate_cached_api_keys(
            &self.api_key_cache,
            Self::load_api_keys_from_keyring,
            Self::persist_api_keys,
            update,
        )
    }

    fn checked_key(key: &str) -> AppResult<String> {
        let key = key.trim().to_string();
        if key.is_empty() {
            return Err(AppError::Keyring("API key cannot be empty".into()));
        }
        Ok(key)
    }

    pub fn api_key_set(&self) -> bool {
        api_key_set_cached(&self.api_key_cache, Self::load_api_keys_from_keyring)
    }

    pub fn get_api_keys(&self) -> AppResult<Vec<String>> {
        get_cached_api_keys(&self.api_key_cache, Self::load_api_keys_from_keyring)
    }

    /// Append a key for fallback. Duplicates are ignored.
    pub fn add_api_key(&self, key: &str) -> AppResult<Vec<String>> {
        let key = Self::checked_key(key)?;
        self.mutate_keys(|keys| {
            if !keys.contains(&key) {
                keys.push(key.clone());
            }
        })
    }

    /// Insert a key at the front, making it primary.
    pub fn connect_api_key(&self, key: &str) -> AppResult<Vec<String>> {
        let key = Self::checked_key(key)?;
        self.mutate_keys(|keys| {
            keys.retain(|existing| existing != &key);
            keys.insert(0, key.clone());
        })
    }

    pub fn remove_api_key(&self, index: usize) -> AppResult<Vec<String>> {
        self.mutate_keys(|keys| {
            if index < keys.len() {
                keys.remove(index);
            }
        })
    }

    pub fn set_primary_api_key(&self, index: usize) -> AppResult<Vec<String>> {
        self.mutate_keys(|keys| {
            if index < keys.len() {
                let key = keys.remove(index);
                keys.insert(0, key);
            }
        })
    }

    /// Drop rejected keys so later turns stop wasting attempts on them.
    pub fn prune_api_keys(&self, dead: &[String]) -> AppResult<Vec<String>> {
        if dead.is_empty() {
            return self.get_api_keys();
        }
        self.mutate_keys(|keys| keys.retain(|key| !dead.contains(key)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn temp_path() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vtp_settings_{nanos}.json"))
    }

    #[test]
    fn loading_legacy_both_false_settings_keeps_preview_mode() {
        let path = temp_path();
        let legacy = AppSettings {
            copy_to_clipboard: false,
            paste_automatically: false,
            ..Default::default()
        };
        fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();

        let loaded = read_settings_file(&path).unwrap();

        assert!(!loaded.copy_to_clipboard);
        assert!(!loaded.paste_automatically);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn saving_legacy_both_false_settings_keeps_preview_mode() {
        let path = temp_path();
        let legacy = AppSettings {
            copy_to_clipboard: false,
            paste_automatically: false,
            ..Default::default()
        };
        let store = SettingsStore {
            path: path.clone(),
            settings: Mutex::new(legacy),
            api_key_cache: Mutex::new(ApiKeyCache::Unloaded),
            shortcut_changes: Mutex::new(()),
        };

        store
            .update(|settings| settings.ui_locale = "en".into())
            .unwrap();
        let saved = read_settings_file(&path).unwrap();

        assert!(!saved.copy_to_clipboard);
        assert!(!saved.paste_automatically);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn loading_legacy_enter_process_shortcut_clears_it() {
        let path = temp_path();
        let legacy = AppSettings {
            process_shortcut: "Enter".into(),
            ..Default::default()
        };
        fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();

        let loaded = read_settings_file(&path).unwrap();

        assert!(loaded.process_shortcut.is_empty());
        let persisted: AppSettings =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert!(persisted.process_shortcut.is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn api_key_cache_hit_does_not_load_backend_twice() {
        let cache = Mutex::new(ApiKeyCache::Unloaded);
        let loads = AtomicUsize::new(0);

        let first = get_cached_api_keys(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(vec!["secret-key".into()])
        })
        .unwrap();
        let second = get_cached_api_keys(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(vec!["should-not-load".into()])
        })
        .unwrap();

        assert_eq!(first, ["secret-key"]);
        assert_eq!(second, ["secret-key"]);
        assert_eq!(loads.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn missing_api_key_is_cached_and_returns_missing_error() {
        let cache = Mutex::new(ApiKeyCache::Unloaded);
        let loads = AtomicUsize::new(0);

        let first = get_cached_api_keys(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(Vec::new())
        });
        let second = get_cached_api_keys(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(vec!["unexpected".into()])
        });

        assert!(matches!(first, Err(AppError::MissingApiKey)));
        assert!(matches!(second, Err(AppError::MissingApiKey)));
        assert_eq!(loads.load(Ordering::Relaxed), 1);
        assert!(!api_key_set_cached(&cache, || panic!(
            "cache miss reloaded backend"
        )));
    }

    #[test]
    fn concurrent_first_load_is_serialized_and_hits_backend_once() {
        let cache = Arc::new(Mutex::new(ApiKeyCache::Unloaded));
        let loads = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(std::sync::Barrier::new(8));

        std::thread::scope(|scope| {
            for _ in 0..8 {
                let cache = Arc::clone(&cache);
                let loads = Arc::clone(&loads);
                let start = Arc::clone(&start);
                scope.spawn(move || {
                    start.wait();
                    let keys = get_cached_api_keys(&cache, || {
                        loads.fetch_add(1, Ordering::Relaxed);
                        std::thread::sleep(std::time::Duration::from_millis(10));
                        Ok(vec!["secret-key".into()])
                    })
                    .unwrap();
                    assert_eq!(keys, ["secret-key"]);
                });
            }
        });

        assert_eq!(loads.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn mutate_appends_once_and_skips_duplicate_persist() {
        let cache = Mutex::new(ApiKeyCache::Present(vec!["old-key".into()]));
        let persists = AtomicUsize::new(0);
        let add = |cache: &Mutex<ApiKeyCache>, candidate: &str| {
            let candidate = candidate.to_string();
            mutate_cached_api_keys(
                cache,
                || panic!("populated cache must not reload"),
                |_| {
                    persists.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                },
                |keys| {
                    if !keys.contains(&candidate) {
                        keys.push(candidate.clone());
                    }
                },
            )
        };

        assert_eq!(add(&cache, "new-key").unwrap(), ["old-key", "new-key"]);
        assert_eq!(add(&cache, "new-key").unwrap(), ["old-key", "new-key"]);
        assert_eq!(persists.load(Ordering::Relaxed), 1);
        assert_eq!(
            get_cached_api_keys(&cache, || panic!("cache should be populated")).unwrap(),
            ["old-key", "new-key"]
        );
    }

    #[test]
    fn failed_persist_does_not_publish_candidate_cache() {
        let cache = Mutex::new(ApiKeyCache::Present(vec!["old-key".into()]));

        let result = mutate_cached_api_keys(
            &cache,
            || panic!("populated cache must not reload"),
            |_candidates| Err(AppError::Keyring("write failed".into())),
            |keys| keys.push("new-key".into()),
        );

        assert!(result.is_err());
        assert_eq!(
            get_cached_api_keys(&cache, || panic!("old cache should remain truthful")).unwrap(),
            ["old-key"]
        );
    }

    #[test]
    fn mutate_to_empty_marks_cache_missing() {
        let cache = Mutex::new(ApiKeyCache::Present(vec!["old-key".into()]));
        let deletes = AtomicUsize::new(0);

        mutate_cached_api_keys(
            &cache,
            || panic!("populated cache must not reload"),
            |candidates| {
                assert!(candidates.is_empty());
                deletes.fetch_add(1, Ordering::Relaxed);
                Ok(())
            },
            |keys| keys.clear(),
        )
        .unwrap();

        assert_eq!(deletes.load(Ordering::Relaxed), 1);
        assert!(matches!(
            get_cached_api_keys(&cache, || panic!(
                "deleted keys should stay cached as missing"
            )),
            Err(AppError::MissingApiKey)
        ));
    }

    #[test]
    fn failed_empty_persist_preserves_previous_cache_state() {
        let cache = Mutex::new(ApiKeyCache::Present(vec!["old-key".into()]));

        let result = mutate_cached_api_keys(
            &cache,
            || panic!("populated cache must not reload"),
            |_candidates| Err(AppError::Keyring("delete failed".into())),
            |keys| keys.clear(),
        );

        assert!(result.is_err());
        assert_eq!(
            get_cached_api_keys(&cache, || panic!("old cache should remain available")).unwrap(),
            ["old-key"]
        );
    }

    #[test]
    fn stored_keys_parse_legacy_single_and_json_lists() {
        assert_eq!(parse_stored_api_keys("raw-legacy-key"), ["raw-legacy-key"]);
        assert_eq!(
            parse_stored_api_keys(r#"["k1", "k2"]"#),
            ["k1", "k2"]
        );
        assert_eq!(
            parse_stored_api_keys("  [\"k1\", \"\", \"  k2\" ]  "),
            ["k1", "k2"]
        );
        assert!(parse_stored_api_keys("").is_empty());
        assert!(parse_stored_api_keys("   ").is_empty());
        assert!(parse_stored_api_keys("[]").is_empty());
    }
}
