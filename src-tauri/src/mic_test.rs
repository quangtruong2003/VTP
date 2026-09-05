use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::recorder::{self, RecorderHandle};

pub struct MicTestManager {
    active: Mutex<Option<RecorderHandle>>,
    generation: AtomicU64,
}

impl MicTestManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }

    async fn start_with<F>(&self, starter: F) -> AppResult<u64>
    where
        F: FnOnce() -> AppResult<RecorderHandle>,
    {
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err(AppError::Other("microphone test already active".into()));
        }
        let handle = starter()?;
        *active = Some(handle);
        Ok(self.generation.fetch_add(1, Ordering::SeqCst) + 1)
    }

    pub async fn start(&self, device_name: Option<String>) -> AppResult<u64> {
        self.start_with(|| recorder::start_recording(device_name.as_deref()))
            .await
    }

    pub async fn level_for(&self, generation: u64) -> Option<u8> {
        if self.generation.load(Ordering::SeqCst) != generation {
            return None;
        }
        self.active.lock().await.as_ref().map(RecorderHandle::level)
    }

    pub async fn stop(&self) -> Option<RecorderHandle> {
        let handle = self.active.lock().await.take();
        if handle.is_some() {
            self.generation.fetch_add(1, Ordering::SeqCst);
        }
        handle
    }
}

impl Default for MicTestManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn second_mic_test_cannot_start_while_one_is_active() {
        let manager = MicTestManager::new();
        manager
            .start_with(|| Ok(crate::recorder::test_handle()))
            .await
            .expect("first mic test");
        let second = manager
            .start_with(|| panic!("second starter must not run"))
            .await;
        assert!(second.is_err());
    }
}
