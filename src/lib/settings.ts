import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppSettings,
  AudioDeviceInfo,
  GeminiModelInfo,
  HistoryEntry,
  MicLevelPayload,
  PlatformInfo,
  PublicSettings,
} from "@/lib/types";
import { RUST_EVENTS } from "@/lib/types";

export const settingsApi = {
  get: () => invoke<PublicSettings>("get_public_settings"),
  save: (settings: AppSettings) => invoke<PublicSettings>("save_settings", { settings }),
  setShortcut: (shortcut: string) => invoke<PublicSettings>("set_shortcut", { shortcut }),
  setProcessShortcut: (shortcut: string) =>
    invoke<PublicSettings>("set_process_shortcut", { shortcut }),
  setCancelShortcut: (shortcut: string) =>
    invoke<PublicSettings>("set_cancel_shortcut", { shortcut }),
  platformInfo: () => invoke<PlatformInfo>("platform_info"),
  connectApiKey: (key: string) => invoke<void>("connect_api_key", { key }),
  deleteApiKey: () => invoke<void>("delete_api_key"),
  listModels: () => invoke<GeminiModelInfo[]>("list_models"),
  listAudioDevices: () => invoke<AudioDeviceInfo[]>("list_audio_devices"),
  micTestStart: (deviceName: string | null) =>
    invoke<void>("mic_test_start", { deviceName }),
  micTestStop: () => invoke<void>("mic_test_stop"),
  testTextInsertion: () => invoke<void>("test_text_insertion"),
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyCopy: (id: string) => invoke<void>("history_copy", { id }),
  historyClear: () => invoke<void>("history_clear"),
};

export async function onSettingsSaved(cb: (s: PublicSettings) => void) {
  return listen<PublicSettings>(RUST_EVENTS.settingsSaved, (e) => cb(e.payload));
}
export async function onMicLevel(cb: (payload: MicLevelPayload) => void) {
  return listen<MicLevelPayload>(RUST_EVENTS.settingsMicLevel, (e) => cb(e.payload));
}
export async function onHistoryChanged(cb: () => void) {
  return listen(RUST_EVENTS.historyChanged, () => cb());
}
export async function onSettingsSection(cb: (section: string) => void) {
  return listen<string>(RUST_EVENTS.settingsSection, (e) => cb(e.payload));
}
export async function onSettingsToast(cb: (s: { kind: string; text: string }) => void) {
  return listen<{ kind: string; text: string }>(RUST_EVENTS.settingsToast, (e) => cb(e.payload));
}
