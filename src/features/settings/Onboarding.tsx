import { useEffect, useRef, useState } from "react";
import { Bot, Check, Mic2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import { SectionCard } from "@/components/section-card";
import { SettingRow } from "@/components/setting-row";
import { Switch } from "@/components/ui/switch";
import { MicLevelIndicator } from "./MicLevelIndicator";
import { ShortcutSection } from "./ShortcutSection";
import { t, type UiLocale } from "@/lib/i18n";
import type {
  AppSettings,
  AudioDeviceInfo,
  PlatformInfo,
  PublicSettings,
} from "@/lib/types";

export function Onboarding({
  settings,
  devices,
  micLevel,
  platformInfo,
  locale,
  connectApiKey,
  onUpdateImmediate,
  onRefreshDevices,
  onMicTestStart,
  onMicTestStop,
  onSetShortcut,
  onSetProcessShortcut,
  onSetCancelShortcut,
  onSetHistoryShortcut,
  onSetSettingsShortcut,
  onShortcutCommitted,
  onTryNow,
  onComplete,
}: {
  settings: AppSettings;
  devices: AudioDeviceInfo[];
  micLevel?: number;
  platformInfo: PlatformInfo;
  locale: UiLocale;
  connectApiKey: (key: string) => Promise<void>;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
  onRefreshDevices: () => Promise<AudioDeviceInfo[]>;
  onMicTestStart: (deviceName: string | null) => Promise<void>;
  onMicTestStop: () => Promise<void>;
  onSetShortcut: (shortcut: string) => Promise<PublicSettings>;
  onSetProcessShortcut: (shortcut: string) => Promise<PublicSettings>;
  onSetCancelShortcut: (shortcut: string) => Promise<PublicSettings>;
  onSetHistoryShortcut: (shortcut: string) => Promise<PublicSettings>;
  onSetSettingsShortcut: (shortcut: string) => Promise<PublicSettings>;
  onShortcutCommitted: (snapshot: PublicSettings) => void;
  onTryNow: () => void;
  onComplete: () => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(settings.api_key_set ? 2 : 1);
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(false);
  const [testingMic, setTestingMic] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [micError, setMicError] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const [deviceRefreshError, setDeviceRefreshError] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(false);
  const micTestOwned = useRef(false);
  const testTargetRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(
    () => () => {
      if (micTestOwned.current) {
        micTestOwned.current = false;
        void onMicTestStop().catch(() => {});
      }
    },
    [onMicTestStop],
  );

  const connect = async () => {
    const candidate = apiKey.trim();
    if (!candidate || connecting) return;
    setConnecting(true);
    setConnectError(false);
    try {
      await connectApiKey(candidate);
      setApiKey("");
      setStep(2);
    } catch {
      setConnectError(true);
    } finally {
      setConnecting(false);
    }
  };

  const toggleMicTest = async () => {
    if (micBusy) return;
    setMicError(false);
    setMicBusy(true);
    try {
      if (testingMic) {
        await onMicTestStop();
        micTestOwned.current = false;
        setTestingMic(false);
      } else {
        await onMicTestStart(settings.device_name);
        micTestOwned.current = true;
        setTestingMic(true);
      }
    } catch {
      setMicError(true);
    } finally {
      setMicBusy(false);
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

  const continueFromMic = async () => {
    if (continuing || micBusy) return;
    setMicError(false);
    setContinuing(true);
    try {
      if (micTestOwned.current) {
        await onMicTestStop();
        micTestOwned.current = false;
        setTestingMic(false);
      }
      setStep(3);
    } catch {
      setMicError(true);
    } finally {
      setContinuing(false);
    }
  };

  const complete = async () => {
    if (completing) return;
    setCompleteError(false);
    setCompleting(true);
    try {
      await onComplete();
    } catch {
      setCompleteError(true);
    } finally {
      setCompleting(false);
    }
  };

  const tryNow = () => {
    testTargetRef.current?.focus();
    onTryNow();
  };

  return (
    <main className="h-screen w-screen overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-[620px] px-6 py-8">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-muted-foreground">
              VoiceToPrompt
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              {step === 1
                ? t(locale, "settings.onboardingConnectTitle")
                : step === 2
                  ? t(locale, "settings.microphoneSetup")
                  : t(locale, "settings.shortcutOutput")}
            </h1>
          </div>
          <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
            {t(locale, "settings.stepOf", { current: step, total: 3 })}
          </span>
        </div>

        {step === 1 ? (
          <SectionCard
            title={t(locale, "settings.onboardingConnectTitle")}
            description={t(locale, "settings.onboardingConnectDesc")}
          >
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-3">
                <Bot className="size-5 text-primary" aria-hidden="true" />
                <div className="text-xs leading-5 text-muted-foreground">
                  {t(locale, "settings.apiKeySecurity")}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="AIza…"
                  aria-label={t(locale, "settings.aiConnection")}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  onClick={() => void connect()}
                  disabled={!apiKey.trim() || connecting}
                  aria-busy={connecting}
                >
                  {connecting ? t(locale, "settings.connecting") : t(locale, "settings.connect")}
                </Button>
              </div>
              {connectError ? (
                <InlineNotice tone="error">{t(locale, "settings.connectionFailed")}</InlineNotice>
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {step === 2 ? (
          <div className="space-y-5">
            <SectionCard
              title={t(locale, "settings.microphoneSetup")}
              description={t(locale, "settings.microphoneSetupDesc")}
            >
              <div className="space-y-4">
                <select
                  aria-label={t(locale, "settings.microphone")}
                  value={settings.device_name ?? "__default__"}
                  onChange={(event) =>
                    onUpdateImmediate({
                      device_name:
                        event.target.value === "__default__" ? null : event.target.value,
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="__default__">{t(locale, "settings.systemDefault")}</option>
                  {devices.map((device) => (
                    <option key={device.name} value={device.name}>
                      {device.name}
                      {device.is_default ? ` (${t(locale, "settings.defaultBadge")})` : ""}
                    </option>
                  ))}
                </select>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void refreshDevices()}
                    disabled={refreshingDevices}
                    aria-busy={refreshingDevices}
                  >
                    {t(locale, "settings.refreshDevices")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void toggleMicTest()}
                    disabled={micBusy}
                    aria-busy={micBusy}
                  >
                    <Mic2 className="size-4" aria-hidden="true" />
                    {t(
                      locale,
                      testingMic ? "settings.stopMicrophoneTest" : "settings.testMicrophone",
                    )}
                  </Button>
                </div>
                {deviceRefreshError ? (
                  <InlineNotice tone="error">{t(locale, "settings.refreshDevicesFailed")}</InlineNotice>
                ) : null}

                <div className="rounded-lg border border-border bg-secondary/30 px-4 py-3">
                  <MicLevelIndicator locale={locale} initialLevel={micLevel} />
                </div>
                {micError ? (
                  <InlineNotice tone="error">{t(locale, "settings.micTestFailed")}</InlineNotice>
                ) : null}
              </div>
            </SectionCard>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => void continueFromMic()}
                disabled={continuing || micBusy}
                aria-busy={continuing}
              >
                {t(locale, "settings.continue")}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Check className="size-4 text-primary" aria-hidden="true" />
                {t(locale, "settings.pressTwiceHint")}
              </div>
            </div>
            {completeError ? (
              <InlineNotice tone="error">{t(locale, "settings.completeFailed")}</InlineNotice>
            ) : null}

            <ShortcutSection
              settings={settings}
              platformInfo={platformInfo}
              locale={locale}
              onSetShortcut={onSetShortcut}
              onSetProcessShortcut={onSetProcessShortcut}
              onSetCancelShortcut={onSetCancelShortcut}
              onSetHistoryShortcut={onSetHistoryShortcut}
              onSetSettingsShortcut={onSetSettingsShortcut}
              onCommitted={onShortcutCommitted}
              onUpdateImmediate={onUpdateImmediate}
            />

            <SectionCard
              title={t(locale, "settings.output")}
              description={t(locale, "settings.shortcutOutputDesc")}
            >
              <SettingRow
                label={t(locale, "settings.insertAutomatically")}
                description={t(locale, "settings.insertAutomaticallyDesc")}
              >
                <Switch
                  aria-label={t(locale, "settings.insertAutomatically")}
                  checked={settings.paste_automatically}
                  onCheckedChange={(checked) =>
                    onUpdateImmediate(
                      !checked && !settings.copy_to_clipboard
                        ? { paste_automatically: false, copy_to_clipboard: true }
                        : { paste_automatically: checked },
                    )
                  }
                />
              </SettingRow>
            </SectionCard>

            <SectionCard>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="size-4 text-primary" aria-hidden="true" />
                  {t(locale, "settings.tryNow")}
                </div>
                <textarea
                  ref={testTargetRef}
                  aria-label={t(locale, "settings.testTarget")}
                  placeholder={t(locale, "settings.testTargetPlaceholder")}
                  rows={4}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex justify-end">
                  <Button type="button" onClick={tryNow}>
                    {t(locale, "settings.tryNow")}
                  </Button>
                </div>
              </div>
            </SectionCard>
            <div className="flex justify-end">
              <Button type="button" onClick={() => void complete()} disabled={completing} aria-busy={completing}>
                {t(locale, "settings.complete")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
