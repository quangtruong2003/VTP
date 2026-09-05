import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { VoiceMeter } from "@/features/overlay/VoiceMeter";
import { t, type UiLocale } from "@/lib/i18n";
import type { AppSettings, AudioDeviceInfo } from "@/lib/types";

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
  micLevel: number;
  locale: UiLocale;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
  onRefreshDevices: () => Promise<AudioDeviceInfo[]>;
  onMicTestStart: (deviceName: string | null) => Promise<void>;
  onMicTestStop: () => Promise<void>;
}) {
  const [testing, setTesting] = useState(false);
  const ownsTest = useRef(false);
  const defaultDevice = devices.find((device) => device.is_default);

  useEffect(
    () => () => {
      if (ownsTest.current) {
        ownsTest.current = false;
        void onMicTestStop();
      }
    },
    [onMicTestStop],
  );

  const startTest = async () => {
    await onMicTestStart(settings.device_name);
    ownsTest.current = true;
    setTesting(true);
  };

  const stopTest = async () => {
    ownsTest.current = false;
    await onMicTestStop();
    setTesting(false);
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title={t(locale, "settings.microphone")}
        description={t(locale, "settings.microphoneDesc")}
      >
        <div className="space-y-4">
          <label className="block text-xs font-medium text-muted-foreground">
            <span className="sr-only">{t(locale, "settings.microphone")}</span>
            <select
              aria-label={t(locale, "settings.microphone")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>
              {settings.device_name ?? t(locale, "settings.systemDefault")}
              {!settings.device_name && defaultDevice ? ` · ${defaultDevice.name}` : ""}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void onRefreshDevices()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t(locale, "settings.refreshDevices")}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="scale-[0.82] origin-left">
                  <VoiceMeter level={micLevel} locale={locale} />
                </div>
                <StatusBadge tone={micLevel > 12 ? "success" : "neutral"}>
                  {t(
                    locale,
                    micLevel > 12 ? "settings.receivingAudio" : "settings.noAudioYet",
                  )}
                </StatusBadge>
              </div>
              <Button
                type="button"
                variant={testing ? "secondary" : "outline"}
                onClick={() => void (testing ? stopTest() : startTest())}
              >
                {t(
                  locale,
                  testing ? "settings.stopMicrophoneTest" : "settings.testMicrophone",
                )}
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

    </div>
  );
}
