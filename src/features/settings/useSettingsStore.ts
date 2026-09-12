import { useCallback, useEffect, useRef, useState } from "react";
import { settingsApi } from "@/lib/settings";
import type {
  AppSettings,
  AudioDeviceInfo,
  PlatformInfo,
  PublicSettings,
} from "@/lib/types";
import { useAutosaveSettings } from "./useAutosaveSettings";

export function settingsLoadErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { detail?: unknown };
    if (typeof candidate.detail === "string" && candidate.detail.trim()) {
      return candidate.detail;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function useSettingsStore() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const autosave = useAutosaveSettings();

  const setSettings = useCallback((next: AppSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
  }, []);

  const applyPublicSettings = useCallback(
    (next: PublicSettings) => setSettings({ ...next }),
    [setSettings],
  );

  const refreshDevices = useCallback(async () => {
    const next = await settingsApi.listAudioDevices();
    setDevices(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void settingsApi.get()
      .then((publicSettings) => {
        if (!cancelled) {
          applyPublicSettings(publicSettings);
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(settingsLoadErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void settingsApi.platformInfo()
      .then((platform) => {
        if (!cancelled) setPlatformInfo(platform);
      })
      .catch(() => {});

    void settingsApi.listAudioDevices()
      .then((audioDevices) => {
        if (!cancelled) setDevices(audioDevices);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [applyPublicSettings]);

  const startMicTest = useCallback(
    (deviceName: string | null) => settingsApi.micTestStart(deviceName),
    [],
  );
  const stopMicTest = useCallback(() => settingsApi.micTestStop(), []);

  const update = useCallback(
    (patch: Partial<AppSettings>, mode: "immediate" | "debounced") => {
      const current = settingsRef.current;
      if (!current) return;
      const next = { ...current, ...patch };
      setSettings(next);
      if (mode === "immediate") autosave.saveImmediate(next);
      else autosave.saveDebounced(next);
    },
    [autosave.saveDebounced, autosave.saveImmediate, setSettings],
  );

  const updateImmediate = useCallback(
    (patch: Partial<AppSettings>) => update(patch, "immediate"),
    [update],
  );
  const updateDebounced = useCallback(
    (patch: Partial<AppSettings>) => update(patch, "debounced"),
    [update],
  );

  return {
    settings,
    platformInfo,
    devices,
    loading,
    loadError,
    autosaveStatus: autosave.status,
    retryAutosave: autosave.retry,
    updateImmediate,
    updateDebounced,
    replaceSettings: applyPublicSettings,
    refreshDevices,
    startMicTest,
    stopMicTest,
  };
}
