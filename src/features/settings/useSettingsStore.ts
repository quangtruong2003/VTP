import { useCallback, useEffect, useRef, useState } from "react";
import { onMicLevel, settingsApi } from "@/lib/settings";
import type {
  AppSettings,
  AudioDeviceInfo,
  PlatformInfo,
  PublicSettings,
} from "@/lib/types";
import { useAutosaveSettings } from "./useAutosaveSettings";

export function useSettingsStore() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
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
    void Promise.all([
      settingsApi.get(),
      settingsApi.platformInfo(),
      settingsApi.listAudioDevices(),
    ])
      .then(([publicSettings, platform, audioDevices]) => {
        if (cancelled) return;
        applyPublicSettings(publicSettings);
        setPlatformInfo(platform);
        setDevices(audioDevices);
        setLoadError(null);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyPublicSettings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onMicLevel(({ level }) => {
      if (!cancelled) setMicLevel(level);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
    micLevel,
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
