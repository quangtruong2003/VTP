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
    Present(String),
}

fn get_cached_api_key<F>(cache: &Mutex<ApiKeyCache>, load: F) -> AppResult<String>
where
    F: FnOnce() -> AppResult<Option<String>>,
{
    let mut guard = cache.lock().unwrap();
    match &*guard {
        ApiKeyCache::Present(key) => return Ok(key.clone()),
        ApiKeyCache::Missing => return Err(AppError::MissingApiKey),
        ApiKeyCache::Unloaded => {}
    }

    match load()? {
        Some(key) if !key.trim().is_empty() => {
            *guard = ApiKeyCache::Present(key.clone());
            Ok(key)
        }
        Some(_) | None => {
            *guard = ApiKeyCache::Missing;
            Err(AppError::MissingApiKey)
        }
    }
}

fn api_key_set_cached<F>(cache: &Mutex<ApiKeyCache>, load: F) -> bool
where
    F: FnOnce() -> AppResult<Option<String>>,
{
    get_cached_api_key(cache, load).is_ok()
}

fn set_cached_api_key<F>(cache: &Mutex<ApiKeyCache>, key: &str, persist: F) -> AppResult<()>
where
    F: FnOnce(&str) -> AppResult<()>,
{
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Keyring("API key cannot be empty".into()));
    }

    let mut guard = cache.lock().unwrap();
    persist(key)?;
    *guard = ApiKeyCache::Present(key.to_string());
    Ok(())
}

fn delete_cached_api_key<F>(cache: &Mutex<ApiKeyCache>, delete: F) -> AppResult<()>
where
    F: FnOnce() -> AppResult<()>,
{
    let mut guard = cache.lock().unwrap();
    delete()?;
    *guard = ApiKeyCache::Missing;
    Ok(())
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

    // ---- API key (OS credential store only) ----

    fn keyring_entry() -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, KEY_ENTRY)
    }

    fn load_api_key_from_keyring() -> AppResult<Option<String>> {
        let entry = Self::keyring_entry()?;
        match entry.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::from(error)),
        }
    }

    pub fn api_key_set(&self) -> bool {
        api_key_set_cached(&self.api_key_cache, Self::load_api_key_from_keyring)
    }

    pub fn get_api_key(&self) -> AppResult<String> {
        get_cached_api_key(&self.api_key_cache, Self::load_api_key_from_keyring)
    }

    pub fn set_api_key(&self, key: &str) -> AppResult<()> {
        set_cached_api_key(&self.api_key_cache, key, |candidate| {
            let entry = Self::keyring_entry()?;
            entry.set_password(candidate).map_err(AppError::from)
        })
    }

    pub fn delete_api_key(&self) -> AppResult<()> {
        delete_cached_api_key(&self.api_key_cache, || {
            let entry = Self::keyring_entry()?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(AppError::from(error)),
            }
        })
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

        let first = get_cached_api_key(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(Some("secret-key".into()))
        })
        .unwrap();
        let second = get_cached_api_key(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(Some("should-not-load".into()))
        })
        .unwrap();

        assert_eq!(first, "secret-key");
        assert_eq!(second, "secret-key");
        assert_eq!(loads.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn missing_api_key_is_cached_and_returns_missing_error() {
        let cache = Mutex::new(ApiKeyCache::Unloaded);
        let loads = AtomicUsize::new(0);

        let first = get_cached_api_key(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(None)
        });
        let second = get_cached_api_key(&cache, || {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(Some("unexpected".into()))
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
                    let key = get_cached_api_key(&cache, || {
                        loads.fetch_add(1, Ordering::Relaxed);
                        std::thread::sleep(std::time::Duration::from_millis(10));
                        Ok(Some("secret-key".into()))
                    })
                    .unwrap();
                    assert_eq!(key, "secret-key");
                });
            }
        });

        assert_eq!(loads.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn successful_replace_updates_memory_cache() {
        let cache = Mutex::new(ApiKeyCache::Present("old-key".into()));
        let persisted = Mutex::new(Vec::<String>::new());

        set_cached_api_key(&cache, "  new-key  ", |candidate| {
            persisted.lock().unwrap().push(candidate.to_string());
            Ok(())
        })
        .unwrap();

        assert_eq!(persisted.lock().unwrap().as_slice(), &["new-key"]);
        assert_eq!(
            get_cached_api_key(&cache, || panic!("cache should be populated")).unwrap(),
            "new-key"
        );
    }

    #[test]
    fn failed_replace_does_not_publish_candidate_cache() {
        let cache = Mutex::new(ApiKeyCache::Present("old-key".into()));

        let result = set_cached_api_key(&cache, "new-key", |_candidate| {
            Err(AppError::Keyring("write failed".into()))
        });

        assert!(result.is_err());
        assert_eq!(
            get_cached_api_key(&cache, || panic!("old cache should remain truthful")).unwrap(),
            "old-key"
        );
    }

    #[test]
    fn successful_delete_marks_cache_missing() {
        let cache = Mutex::new(ApiKeyCache::Present("old-key".into()));
        let deletes = AtomicUsize::new(0);

        delete_cached_api_key(&cache, || {
            deletes.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .unwrap();

        assert_eq!(deletes.load(Ordering::Relaxed), 1);
        assert!(matches!(
            get_cached_api_key(&cache, || panic!(
                "deleted key should stay cached as missing"
            )),
            Err(AppError::MissingApiKey)
        ));
    }

    #[test]
    fn failed_delete_preserves_previous_cache_state() {
        let cache = Mutex::new(ApiKeyCache::Present("old-key".into()));

        let result =
            delete_cached_api_key(&cache, || Err(AppError::Keyring("delete failed".into())));

        assert!(result.is_err());
        assert_eq!(
            get_cached_api_key(&cache, || panic!("old cache should remain available")).unwrap(),
            "old-key"
        );
    }
}
