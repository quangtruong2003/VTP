use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::{AppError, AppResult};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{InputCallbackInfo, SampleFormat, StreamConfig};

/// A completed recording: interleaved f32 samples plus device metadata.
pub struct Recording {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_ms: u64,
    #[allow(dead_code)] // useful for diagnostics; not read by the pipeline
    pub peak_level: u8,
}

/// Data shared between the audio callback (RT thread) and the capture
/// thread. The callback only does `queue.push` — no locks, no allocation.
struct Shared {
    queue: Arc<crossbeam_queue::ArrayQueue<f32>>,
    done: AtomicBool,
    paused: Arc<AtomicBool>,
    samples: Mutex<Vec<f32>>,
}

/// Handle that keeps the capture thread alive. cpal's WASAPI `Stream` is
/// not `Sync` (it holds a raw HANDLE), so it lives on its own thread and is
/// controlled via messages — this keeps the whole session `Send + Sync`
/// while letting `stop()` cleanly join and collect.
pub struct RecorderHandle {
    ctrl: std::sync::mpsc::Sender<Ctrl>,
    level: Arc<AtomicU8>,
    paused: Arc<AtomicBool>,
    result_rx: std::sync::Mutex<Option<std::sync::mpsc::Receiver<RecordingShared>>>,
    pub sample_rate: u32,
    pub channels: u16,
}

enum Ctrl {
    Stop,
}

/// Data the capture thread returns when stopping.
struct RecordingShared {
    samples: Vec<f32>,
    peak_level: u8,
}

#[cfg(test)]
pub fn test_handle() -> RecorderHandle {
    let (ctrl, _ctrl_rx) = std::sync::mpsc::channel();
    let (_result_tx, result_rx) = std::sync::mpsc::channel();
    RecorderHandle {
        ctrl,
        level: Arc::new(AtomicU8::new(0)),
        paused: Arc::new(AtomicBool::new(false)),
        result_rx: std::sync::Mutex::new(Some(result_rx)),
        sample_rate: 16_000,
        channels: 1,
    }
}

impl RecorderHandle {
    /// Current input level for the UI meter (0-255).
    pub fn level(&self) -> u8 {
        self.level.load(Ordering::Relaxed)
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
        self.level.store(0, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Release);
    }

    /// Signal stop, join the capture thread, and collect the recording.
    pub fn stop(self) -> Recording {
        let _ = self.ctrl.send(Ctrl::Stop);
        let recording = if let Ok(mut guard) = self.result_rx.lock() {
            guard.take().and_then(|rx| rx.recv().ok())
        } else {
            None
        };
        let (samples, peak_level) = recording
            .map(|r| (r.samples, r.peak_level))
            .unwrap_or((Vec::new(), 0));
        Recording {
            duration_ms: duration_ms_of(&samples, self.sample_rate, self.channels),
            samples,
            sample_rate: self.sample_rate,
            channels: self.channels,
            peak_level,
        }
    }
}

fn duration_ms_of(samples: &[f32], sample_rate: u32, channels: u16) -> u64 {
    let ch = channels as usize;
    if ch > 0 && sample_rate > 0 {
        (samples.len() / ch) as u64 * 1_000 / sample_rate as u64
    } else {
        0
    }
}

fn ui_level_from_peak(peak: f32) -> u8 {
    if peak <= 0.004 {
        return 0;
    }
    let normalized = ((peak - 0.004) / 0.346).clamp(0.0, 1.0);
    (normalized.powf(0.55) * 255.0).round() as u8
}

/// List available input devices, marking the host default.
pub fn list_input_devices() -> Vec<(String, bool)> {
    let host = cpal::default_host();
    let default_name = host.default_input_device().and_then(|d| d.name().ok());
    let mut out = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                let is_default = default_name.as_deref() == Some(name.as_str());
                out.push((name, is_default));
            }
        }
    }
    if out.is_empty() {
        if let Some(d) = host.default_input_device() {
            if let Ok(n) = d.name() {
                out.push((n, true));
            }
        }
    }
    out
}

fn pick_device(name: Option<&str>) -> AppResult<cpal::Device> {
    let host = cpal::default_host();
    match name {
        Some(n) => host
            .input_devices()
            .map_err(|e| AppError::Recording(e.to_string()))?
            .find(|d| d.name().map(|dn| dn == n).unwrap_or(false))
            .or_else(|| host.default_input_device())
            .ok_or_else(|| AppError::DeviceNotFound(n.to_string())),
        None => host.default_input_device().ok_or(AppError::NoInputDevice),
    }
}

/// Begin capturing. Spawns a dedicated thread that **creates and owns** the
/// cpal stream (WASAPI streams contain raw HANDLEs and are neither Send nor
/// Sync — building them on the owning thread sidesteps this entirely);
/// returns immediately.
pub fn start_recording(device_name: Option<&str>) -> AppResult<RecorderHandle> {
    let device = pick_device(device_name)?;
    let supported = device
        .default_input_config()
        .map_err(|e| AppError::Recording(e.to_string()))?;

    // Use the device's default format verbatim. Do NOT force 16 kHz/mono:
    // cpal's WASAPI backend requires an exact format match (it treats
    // IsFormatSupported's S_FALSE as unsupported and never sets
    // AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM), so a forced 16 kHz config makes
    // stream creation fail on most Windows mics (they run at 44.1/48 kHz)
    // and we'd record 0 samples. Gemini accepts any WAV rate.
    let config: StreamConfig = supported.clone().into();
    let sample_rate = config.sample_rate.0;
    let channels = config.channels;

    let capacity = (sample_rate as usize * channels as usize * 5).max(8_000);
    let queue = Arc::new(crossbeam_queue::ArrayQueue::new(capacity));
    let level = Arc::new(AtomicU8::new(0));
    let paused = Arc::new(AtomicBool::new(false));
    let shared = Arc::new(Shared {
        queue: queue.clone(),
        done: AtomicBool::new(false),
        paused: paused.clone(),
        samples: Mutex::new(Vec::with_capacity(
            sample_rate as usize * channels as usize * 4,
        )),
    });

    let (result_tx, result_rx) = std::sync::mpsc::channel::<RecordingShared>();
    let (ctrl_tx, ctrl_rx) = std::sync::mpsc::channel::<Ctrl>();

    let sample_format = supported.sample_format();
    let cb_shared = shared.clone();
    let thread_level = level.clone();
    std::thread::Builder::new()
        .name("audio-capture".into())
        .spawn(move || {
            // Build the stream here: the raw HANDLE it holds never leaves
            // this thread.
            let err_cb = |e| log::warn!("audio stream error: {e}");
            let stream = match sample_format {
                SampleFormat::F32 => device.build_input_stream(
                    &config,
                    make_callback::<f32>(cb_shared.clone()),
                    err_cb,
                    None,
                ),
                SampleFormat::I16 => device.build_input_stream(
                    &config,
                    make_callback::<i16>(cb_shared.clone()),
                    err_cb,
                    None,
                ),
                SampleFormat::U16 => device.build_input_stream(
                    &config,
                    make_callback::<u16>(cb_shared.clone()),
                    err_cb,
                    None,
                ),
                other => {
                    log::error!("unsupported sample format: {other:?}");
                    let _ = result_tx.send(RecordingShared {
                        samples: Vec::new(),
                        peak_level: 0,
                    });
                    return;
                }
            };
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    log::error!("stream build failed: {e}");
                    let _ = result_tx.send(RecordingShared {
                        samples: Vec::new(),
                        peak_level: 0,
                    });
                    return;
                }
            };
            if let Err(e) = stream.play() {
                log::error!("stream play failed: {e}");
                let _ = result_tx.send(RecordingShared {
                    samples: Vec::new(),
                    peak_level: 0,
                });
                return;
            }

            let mut batch: Vec<f32> = Vec::with_capacity(4_096);
            loop {
                match ctrl_rx.try_recv() {
                    Ok(Ctrl::Stop) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                    Err(std::sync::mpsc::TryRecvError::Empty) => {}
                }
                batch.clear();
                while let Some(s) = shared.queue.pop() {
                    batch.push(s);
                    if batch.len() >= 4_096 {
                        break;
                    }
                }
                let mut peak = 0.0f32;
                for s in &batch {
                    peak = peak.max(s.abs());
                }
                let old = thread_level.load(Ordering::Relaxed);
                let decayed = ((old as f32) * 0.72) as u8;
                let next = if shared.paused.load(Ordering::Acquire) {
                    0
                } else {
                    ui_level_from_peak(peak).max(decayed)
                };
                thread_level.store(next, Ordering::Relaxed);
                if !batch.is_empty() {
                    shared.samples.lock().unwrap().extend_from_slice(&batch);
                } else if wait_for_stop_when_idle(&ctrl_rx, Duration::from_millis(10)) {
                    break;
                }
            }
            // Close the callback gate first, then deterministically quiesce
            // the WASAPI stream. CPAL's WASAPI Stream::drop sends Terminate
            // and joins its worker thread, so no callback can enqueue after
            // this returns and the queue can be drained without a fixed wait.
            shared.done.store(true, Ordering::Release);
            drop(stream);
            drain_pending_samples(&shared, &mut batch);

            let samples = std::mem::take(&mut *shared.samples.lock().unwrap());
            let peak_level = thread_level.load(Ordering::Relaxed);
            let _ = result_tx.send(RecordingShared {
                samples,
                peak_level,
            });
        })
        .map_err(|e| AppError::Recording(format!("spawn capture thread: {e}")))?;

    Ok(RecorderHandle {
        ctrl: ctrl_tx,
        level,
        paused,
        result_rx: std::sync::Mutex::new(Some(result_rx)),
        sample_rate,
        channels,
    })
}

fn wait_for_stop_when_idle(ctrl_rx: &std::sync::mpsc::Receiver<Ctrl>, timeout: Duration) -> bool {
    match ctrl_rx.recv_timeout(timeout) {
        Ok(Ctrl::Stop) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => true,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => false,
    }
}

fn drain_pending_samples(shared: &Shared, batch: &mut Vec<f32>) {
    batch.clear();
    while let Some(sample) = shared.queue.pop() {
        batch.push(sample);
    }
    if !batch.is_empty() {
        shared.samples.lock().unwrap().extend_from_slice(batch);
    }
}

fn push_input_samples<S: cpal::SizedSample + Send + 'static>(shared: &Shared, data: &[S]) {
    if shared.done.load(Ordering::Acquire) || shared.paused.load(Ordering::Acquire) {
        return;
    }
    for sample in data {
        // Widen to f32 per the device's sample format; the callback itself
        // only pushes into the lock-free queue.
        let value: f32 = widen::<S>(*sample);
        let _ = shared.queue.push(value);
    }
}

fn make_callback<S: cpal::SizedSample + Send + 'static>(
    shared: Arc<Shared>,
) -> impl FnMut(&[S], &InputCallbackInfo) + Send + 'static {
    move |data: &[S], _info: &InputCallbackInfo| push_input_samples(&shared, data)
}

#[inline]
fn widen<S: cpal::SizedSample + 'static>(s: S) -> f32 {
    // Monomorphized per S; TypeId branches fold away at compile time.
    use std::any::TypeId;
    if TypeId::of::<S>() == TypeId::of::<f32>() {
        // SAFETY: S is f32 here, verified by TypeId
        unsafe { *(&s as *const S as *const f32) }
    } else if TypeId::of::<S>() == TypeId::of::<i16>() {
        // SAFETY: S is i16 here, verified by TypeId
        let raw = unsafe { *(&s as *const S as *const i16) };
        raw as f32 / 32_768.0
    } else if TypeId::of::<S>() == TypeId::of::<u16>() {
        // SAFETY: S is u16 here, verified by TypeId
        let raw = unsafe { *(&s as *const S as *const u16) };
        (raw as f32 - 32_768.0) / 32_768.0
    } else if TypeId::of::<S>() == TypeId::of::<i32>() {
        // SAFETY: S is i32 here, verified by TypeId
        let raw = unsafe { *(&s as *const S as *const i32) };
        raw as f32 / 2_147_483_648.0
    } else {
        // Fallback for exotic formats (u8, f64, …): normalize around the
        // type's equilibrium so silence maps to 0, then convert the float
        // to f32 (cpal::Sample re-exports dasp's to_sample).
        use cpal::Sample;
        let val: S::Float = s.to_float_sample();
        let eq: S::Float = S::EQUILIBRIUM.to_float_sample();
        (val - eq).to_sample::<f32>()
    }
}

/// Target sample rate for speech recognition. Gemini / Whisper models operate natively
/// on 16 kHz audio. Resampling to 16 kHz Mono reduces payload size by ~80-85% compared
/// to 48 kHz stereo, drastically reducing upload latency and API processing time.
pub const TARGET_SAMPLE_RATE: u32 = 16_000;

/// High-performance audio converter to 16 kHz Mono f32 samples.
pub fn resample_to_16k_mono(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<f32> {
    if samples.is_empty() || sample_rate == 0 || channels == 0 {
        return Vec::new();
    }

    let ch = channels as usize;
    // Step 1: Downmix interleaved channels to mono
    let mono: Vec<f32> = if ch == 1 {
        samples.to_vec()
    } else {
        let frames = samples.len() / ch;
        let mut mono = Vec::with_capacity(frames);
        let ch_inv = 1.0 / (ch as f32);
        for frame in samples.chunks_exact(ch) {
            let sum: f32 = frame.iter().sum();
            mono.push(sum * ch_inv);
        }
        mono
    };

    // Step 2: Resample to 16,000 Hz if needed
    if sample_rate == TARGET_SAMPLE_RATE {
        return mono;
    }

    let ratio = sample_rate as f64 / TARGET_SAMPLE_RATE as f64;
    let target_len = ((mono.len() as f64) / ratio).round() as usize;
    let mut resampled = Vec::with_capacity(target_len);

    for i in 0..target_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;

        if idx + 1 < mono.len() {
            let s0 = mono[idx];
            let s1 = mono[idx + 1];
            resampled.push(s0 + frac * (s1 - s0));
        } else if idx < mono.len() {
            resampled.push(mono[idx]);
        }
    }

    resampled
}

/// 16-bit PCM WAV (RIFF header) — the container for Gemini `audio/wav`.
/// Converts audio to 16 kHz Mono to minimize upload size and maximize API speed
/// without any loss in speech recognition quality.
pub fn samples_to_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let mono_16k = resample_to_16k_mono(samples, sample_rate, channels);
    let target_rate = TARGET_SAMPLE_RATE;
    let target_channels = 1u16;

    let data_len = mono_16k.len() * 2;
    let mut out = Vec::with_capacity(44 + data_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&target_channels.to_le_bytes());
    out.extend_from_slice(&target_rate.to_le_bytes());
    out.extend_from_slice(&(target_rate * target_channels as u32 * 2).to_le_bytes());
    out.extend_from_slice(&((target_channels * 2) as u16).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for s in &mono_16k {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_level_mapping_is_visibly_responsive() {
        assert_eq!(ui_level_from_peak(0.0), 0);
        assert!(ui_level_from_peak(0.05) >= 70);
        assert!(ui_level_from_peak(0.20) >= 140);
    }

    #[test]
    fn resample_48k_stereo_to_16k_mono_reduces_size_sixfold() {
        // 1 second of 48 kHz stereo = 96,000 samples
        let input: Vec<f32> = (0..96_000).map(|i| (i as f32 * 0.01).sin()).collect();
        let mono = resample_to_16k_mono(&input, 48_000, 2);
        // 1 second of 16 kHz mono = 16,000 samples
        assert_eq!(mono.len(), 16_000);

        let wav = samples_to_wav(&input, 48_000, 2);
        // 44-byte RIFF header + 16,000 samples * 2 bytes = 32,044 bytes
        assert_eq!(wav.len(), 44 + 32_000);
        // Check sample rate in WAV header (bytes 24..28) is 16,000
        let wav_sample_rate = u32::from_le_bytes(wav[24..28].try_into().unwrap());
        assert_eq!(wav_sample_rate, 16_000);
        // Check channel count in WAV header (bytes 22..24) is 1 (Mono)
        let wav_channels = u16::from_le_bytes(wav[22..24].try_into().unwrap());
        assert_eq!(wav_channels, 1);
    }

    fn test_shared(initial_samples: &[f32], paused: bool, done: bool) -> Shared {
        let queue = Arc::new(crossbeam_queue::ArrayQueue::new(32));
        Shared {
            queue,
            done: AtomicBool::new(done),
            paused: Arc::new(AtomicBool::new(paused)),
            samples: Mutex::new(initial_samples.to_vec()),
        }
    }

    #[test]
    fn final_drain_preserves_samples_already_collected_and_pending() {
        let shared = test_shared(&[0.1, 0.2], false, true);
        shared.queue.push(0.3).unwrap();
        shared.queue.push(0.4).unwrap();
        let mut batch = vec![9.0];

        drain_pending_samples(&shared, &mut batch);

        assert_eq!(*shared.samples.lock().unwrap(), vec![0.1, 0.2, 0.3, 0.4]);
        assert!(shared.queue.is_empty());
    }

    #[test]
    fn terminal_callback_gate_rejects_new_samples() {
        let shared = test_shared(&[], false, true);

        push_input_samples(&shared, &[0.25f32, 0.5]);

        assert!(shared.queue.is_empty());
    }

    #[test]
    fn paused_callback_rejects_samples_but_resume_accepts_them() {
        let shared = test_shared(&[], true, false);
        push_input_samples(&shared, &[0.25f32]);
        assert!(shared.queue.is_empty());

        shared.paused.store(false, Ordering::Release);
        push_input_samples(&shared, &[0.5f32]);
        assert_eq!(shared.queue.pop(), Some(0.5));
    }

    #[test]
    fn duration_uses_sample_frames_rate_and_channels() {
        let samples = vec![0.0; 96_000];
        assert_eq!(duration_ms_of(&samples, 48_000, 2), 1_000);
        assert_eq!(duration_ms_of(&samples[..48_000], 48_000, 2), 500);
    }

    #[test]
    fn empty_recording_has_zero_duration() {
        assert_eq!(duration_ms_of(&[], 48_000, 2), 0);
        assert_eq!(duration_ms_of(&[], 0, 0), 0);
    }

    #[test]
    fn idle_control_wait_observes_stop_and_sender_disconnect() {
        let (stop_tx, stop_rx) = std::sync::mpsc::channel();
        stop_tx.send(Ctrl::Stop).unwrap();
        assert!(wait_for_stop_when_idle(&stop_rx, Duration::from_secs(1)));

        let (drop_tx, drop_rx) = std::sync::mpsc::channel();
        drop(drop_tx);
        assert!(wait_for_stop_when_idle(&drop_rx, Duration::from_secs(1)));
    }

    #[test]
    #[ignore = "manual CPU latency benchmark; run in release mode with --nocapture"]
    fn benchmark_audio_encode_path() {
        use std::hint::black_box;
        use std::time::Instant;

        const AUDIO_RUNS: usize = 5;
        const BASE64_RUNS: usize = 20;
        const VEC_CLONE_RUNS: usize = 500;
        const ARC_CLONE_RUNS: usize = 100_000;

        for seconds in [5usize, 15, 30] {
            let source_samples = 48_000 * 2 * seconds;
            let input: Vec<f32> = (0..source_samples)
                .map(|i| ((i as f32) * 0.011).sin() * 0.5)
                .collect();

            let started = Instant::now();
            for _ in 0..AUDIO_RUNS {
                black_box(resample_to_16k_mono(black_box(&input), 48_000, 2));
            }
            let resample_ms = started.elapsed().as_secs_f64() * 1_000.0 / AUDIO_RUNS as f64;

            let started = Instant::now();
            for _ in 0..AUDIO_RUNS {
                black_box(samples_to_wav(black_box(&input), 48_000, 2));
            }
            let wav_ms = started.elapsed().as_secs_f64() * 1_000.0 / AUDIO_RUNS as f64;

            let wav = samples_to_wav(&input, 48_000, 2);
            let started = Instant::now();
            for _ in 0..BASE64_RUNS {
                black_box(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    black_box(wav.as_slice()),
                ));
            }
            let base64_ms = started.elapsed().as_secs_f64() * 1_000.0 / BASE64_RUNS as f64;

            let started = Instant::now();
            for _ in 0..VEC_CLONE_RUNS {
                black_box(wav.clone());
            }
            let vec_clone_ns =
                started.elapsed().as_secs_f64() * 1_000_000_000.0 / VEC_CLONE_RUNS as f64;

            let shared: Arc<[u8]> = wav.into();
            let started = Instant::now();
            for _ in 0..ARC_CLONE_RUNS {
                black_box(Arc::clone(&shared));
            }
            let arc_clone_ns =
                started.elapsed().as_secs_f64() * 1_000_000_000.0 / ARC_CLONE_RUNS as f64;

            println!(
                "audio_bench seconds={seconds} wav_bytes={} resample_ms={resample_ms:.3} samples_to_wav_ms={wav_ms:.3} base64_ms={base64_ms:.3} old_vec_clone_ns={vec_clone_ns:.1} shared_arc_clone_ns={arc_clone_ns:.1}",
                shared.len()
            );
        }
    }
}
