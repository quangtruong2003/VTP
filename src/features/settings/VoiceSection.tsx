import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import { SectionCard } from "@/components/section-card";
import { t, type UiLocale } from "@/lib/i18n";
import type { AppSettings, AudioDeviceInfo } from "@/lib/types";
import { MicLevelIndicator } from "./MicLevelIndicator";

export function VoiceSection({
  settings,
  devices,
  micLevel,
  locale,
  onUpdateImmediate,
  onRefreshDevices,
  onMicTestStart,
  onMicTestStop,
}: {
  settings: AppSettings;
  devices: AudioDeviceInfo[];
  micLevel?: number;
  locale: UiLocale;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
  onRefreshDevices: () => Promise<AudioDeviceInfo[]>;
  onMicTestStart: (deviceName: string | null) => Promise<void>;
  onMicTestStop: () => Promise<void>;
}) {
  const [testing, setTesting] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState(false);
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const [deviceRefreshError, setDeviceRefreshError] = useState(false);
  const ownsTest = useRef(false);
  const defaultDevice = devices.find((device) => device.is_default);

  useEffect(
    () => () => {
      if (ownsTest.current) {
        ownsTest.current = false;
        void onMicTestStop().catch(() => {});
      }
    },
    [onMicTestStop],
  );

  const toggleTest = async () => {
    if (testBusy) return;
    setTestError(false);
    setTestBusy(true);
    try {
      if (testing) {
        await onMicTestStop();
        ownsTest.current = false;
        setTesting(false);
      } else {
        await onMicTestStart(settings.device_name);
        ownsTest.current = true;
        setTesting(true);
      }
    } catch {
      setTestError(true);
    } finally {
      setTestBusy(false);
    }
  };

  const refreshDevices = async () => {
    if (refreshingDevices) return;
    setDeviceRefreshError(false);
    setRefreshingDevices(true);
    try {
      await onRefreshDevices();
    } catch {
      setDeviceRefreshError(true);
    } finally {
      setRefreshingDevices(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <SectionCard
        title={t(locale, "settings.microphone")}
        description={t(locale, "settings.microphoneDesc")}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            <span className="sr-only">{t(locale, "settings.microphone")}</span>
            <select
              aria-label={t(locale, "settings.microphone")}
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={settings.device_name ?? "__default__"}
              onChange={(event) =>
                onUpdateImmediate({
                  device_name:
                    event.target.value === "__default__" ? null : event.target.value,
                })
              }
            >
              <option value="__default__">{t(locale, "settings.systemDefault")}</option>
              {devices.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.name}
                  {device.is_default ? ` (${t(locale, "settings.defaultBadge")})` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="text-[11px]">
              {settings.device_name ?? t(locale, "settings.systemDefault")}
              {!settings.device_name && defaultDevice ? ` · ${defaultDevice.name}` : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => void refreshDevices()}
              disabled={refreshingDevices}
              aria-busy={refreshingDevices}
            >
              <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
              {t(locale, "settings.refreshDevices")}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <MicLevelIndicator locale={locale} compact initialLevel={micLevel} />
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  variant={testing ? "secondary" : "outline"}
                  onClick={() => void toggleTest()}
                  disabled={testBusy}
                  aria-busy={testBusy}
                >
                {t(
                  locale,
                  testing ? "settings.stopMicrophoneTest" : "settings.testMicrophone",
                )}
              </Button>
            </div>
          </div>
          {deviceRefreshError ? (
            <InlineNotice tone="error">{t(locale, "settings.refreshDevicesFailed")}</InlineNotice>
          ) : null}
          {testError ? (
            <InlineNotice tone="error">{t(locale, "settings.micTestFailed")}</InlineNotice>
          ) : null}
        </div>
      </SectionCard>

    </div>
  );
}
