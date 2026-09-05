import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "@/lib/types";
import { settingsApi } from "@/lib/settings";
import {
  createAutosaveController,
  createAutosaveQueue,
  type AutosaveController,
  type AutosaveQueue,
} from "./autosave";
import type { AutosaveStatus } from "./SettingsShell";

export function useAutosaveSettings() {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<AutosaveQueue<AppSettings> | null>(null);
  const controllerRef = useRef<AutosaveController<AppSettings> | null>(null);

  if (!queueRef.current) {
    queueRef.current = createAutosaveQueue(
      (snapshot) => settingsApi.save(snapshot),
      (nextStatus) => {
        if (savedTimer.current) {
          clearTimeout(savedTimer.current);
          savedTimer.current = null;
        }
        setStatus(nextStatus);
        if (nextStatus === "saved") {
          savedTimer.current = setTimeout(() => setStatus("idle"), 1_200);
        }
      },
    );
    controllerRef.current = createAutosaveController(queueRef.current, 400);
  }

  useEffect(
    () => () => {
      controllerRef.current?.cancelDebounce();
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const saveImmediate = useCallback((next: AppSettings) => {
    controllerRef.current?.saveImmediate(next);
  }, []);

  const saveDebounced = useCallback((next: AppSettings) => {
    controllerRef.current?.saveDebounced(next);
  }, []);

  const retry = useCallback(() => {
    queueRef.current?.retry();
  }, []);

  return { saveImmediate, saveDebounced, retry, status };
}
