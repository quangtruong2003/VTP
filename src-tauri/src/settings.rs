use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::types::AppSettings;

const SERVICE: &str = "com.voicetoprompt.app";
const KEY_ENTRY: &str = "gemini-api-key";

/// All persisted state: non-secret settings in settings.json (in the OS
/// app-data dir), the API key exclusively in the OS credential store
/// (Windows Credential Manager / macOS Keychain via the `keyring` crate).
pub struct SettingsStore {
    path: PathBuf,
    settings: Mutex<AppSettings>,
}

impl SettingsStore {
    pub fn load() -> AppResult<Self> {
        let dir = dirs::data_dir()
            .map(|d| d.join("voice-to-prompt"))
            .ok_or_else(|| AppError::Settings("cannot resolve data dir".into()))?;
        fs::create_dir_all(&dir)?;
        let path = dir.join("settings.json");
        let settings = if path.exists() {
            let raw = fs::read_to_string(&path)?;
            serde_json::from_str(&raw).map_err(|e| AppError::Settings(e.to_string()))?
        } else {
            AppSettings::default()
        };
        Ok(Self {
            path,
            settings: Mutex::new(settings),
        })
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

    pub fn api_key_set(&self) -> bool {
        Self::keyring_entry()
            .and_then(|e| e.get_password())
            .map(|p| !p.trim().is_empty())
            .unwrap_or(false)
    }

    pub fn get_api_key(&self) -> AppResult<String> {
        let entry = Self::keyring_entry()?;
        let key = entry.get_password().map_err(AppError::from)?;
        if key.trim().is_empty() {
            return Err(AppError::MissingApiKey);
        }
        Ok(key)
    }

    pub fn set_api_key(&self, key: &str) -> AppResult<()> {
        let key = key.trim();
        if key.is_empty() {
            return Err(AppError::Keyring("API key cannot be empty".into()));
        }
        let entry = Self::keyring_entry()?;
        // keyring 3 has no update_password; delete (if present) then set.
        match entry.get_password() {
            Ok(_) => {
                let _ = entry.delete_credential();
            }
            Err(_) => {}
        }
        entry.set_password(key).map_err(AppError::from)?;
        Ok(())
    }

    pub fn delete_api_key(&self) -> AppResult<()> {
        let entry = Self::keyring_entry()?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::from(e)),
        }
    }
}
