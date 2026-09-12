import { useCallback, useEffect, useRef, useState } from "react";
import { resolveUiLocale, t } from "@/lib/i18n";
import { SettingsShell } from "@/features/settings/SettingsShell";
import type { SettingsSection } from "@/features/settings/SettingsSidebar";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { GeneralSection } from "@/features/settings/GeneralSection";
import { VoiceSection } from "@/features/settings/VoiceSection";
import { OutputSection } from "@/features/settings/OutputSection";
import { AiPromptSection } from "@/features/settings/AiPromptSection";
import { ShortcutSection } from "@/features/settings/ShortcutSection";
import { HistorySection } from "@/features/settings/HistorySection";
import { Onboarding } from "@/features/settings/Onboarding";
import { overlayApi } from "@/lib/overlay";
import { onSettingsSection, settingsApi } from "@/lib/settings";
import type { GeminiModelInfo } from "@/lib/types";

function isSettingsSection(value: string): value is SettingsSection {
  return ["general", "voice", "ai_prompt", "shortcut", "output", "history"].includes(value);
}

function initialSettingsSection(): SettingsSection {
  if (typeof window === "undefined") return "general";
  const requested = new URLSearchParams(window.location.search).get("section");
  return requested && isSettingsSection(requested) ? requested : "general";
}

function SettingsLoadingState() {
  const locale = resolveUiLocale(
    "system",
    typeof navigator === "undefined" ? "en" : navigator.language,
  );
  const label = t(locale, "settings.loading");

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex h-screen w-screen bg-background text-foreground"
    >
      <aside className="w-40 shrink-0 border-r border-border bg-card/50 px-2 py-3.5">
        <div className="mb-4 h-3 w-24 animate-pulse rounded bg-secondary" />
        <div className="space-y-2">
          {["w-24", "w-20", "w-28", "w-20", "w-24", "w-16"].map((width, index) => (
            <div key={`${width}-${index}`} className={`h-7 animate-pulse rounded-md bg-secondary/70 ${width}`} />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-[540px] px-4 py-4">
          <div className="mb-3.5 flex min-h-7 items-center justify-between gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-secondary" />
            <div className="h-4 w-14 animate-pulse rounded bg-secondary/70" />
          </div>
          <div className="space-y-3.5">
            <div className="h-32 animate-pulse rounded-[var(--radius-lg)] border border-border bg-card/70" />
            <div className="h-24 animate-pulse rounded-[var(--radius-lg)] border border-border bg-card/70" />
          </div>
        </div>
      </main>
    </div>
  );
}

export function SettingsApp() {
  const store = useSettingsStore();
  const [section, setSection] = useState<SettingsSection>(initialSettingsSection);
  const [models, setModels] = useState<GeminiModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(false);
  const modelsRequestRef = useRef(0);
  const modelsLoadingRef = useRef(false);
  const modelsLoadedRef = useRef(false);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const toggleOverlay = useCallback(() => {
    void Promise.resolve(overlayApi.toggle()).catch(() => {
      // The settings surface stays usable if the overlay cannot be opened.
    });
  }, []);

  const refreshPublicSettings = useCallback(async () => {
    store.replaceSettings(await settingsApi.get());
  }, [store.replaceSettings]);

  const loadModels = useCallback(async () => {
    if (modelsLoadingRef.current || modelsLoadedRef.current) return;
    const requestId = ++modelsRequestRef.current;
    modelsLoadingRef.current = true;
    setModelsLoading(true);
    setModelsError(false);
    try {
      const nextModels = await settingsApi.listModels();
      if (modelsRequestRef.current === requestId) {
        modelsLoadedRef.current = true;
        setModels(nextModels);
      }
    } catch {
      if (modelsRequestRef.current === requestId) setModelsError(true);
    } finally {
      if (modelsRequestRef.current === requestId) {
        modelsLoadingRef.current = false;
        setModelsLoading(false);
      }
    }
  }, []);

  const connectApiKey = useCallback(
    async (key: string) => {
      await settingsApi.connectApiKey(key);
      modelsRequestRef.current += 1;
      modelsLoadingRef.current = false;
      modelsLoadedRef.current = false;
      setModels([]);
      setModelsLoading(false);
      await refreshPublicSettings();
    },
    [refreshPublicSettings],
  );
  const connectApiKeyForOnboarding = useCallback(
    async (key: string) => {
      setOnboardingActive(true);
      await settingsApi.connectApiKey(key);
      modelsRequestRef.current += 1;
      modelsLoadingRef.current = false;
      modelsLoadedRef.current = false;
      setModels([]);
      setModelsLoading(false);
      await refreshPublicSettings();
    },
    [refreshPublicSettings],
  );

  const disconnectApiKey = useCallback(async () => {
    modelsRequestRef.current += 1;
    modelsLoadingRef.current = false;
    setModelsLoading(false);
    await settingsApi.deleteApiKey();
    modelsLoadedRef.current = false;
    setModels([]);
    await refreshPublicSettings();
  }, [refreshPublicSettings]);

  useEffect(() => {
    let disposed = false;
    let unlistenSection: (() => void) | undefined;
    void onSettingsSection((target) => {
      if (!disposed && isSettingsSection(target)) setSection(target);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenSection = unlisten;
      })
      .catch(() => {
        // Settings remains usable when the optional navigation event is unavailable.
      });

    return () => {
      disposed = true;
      unlistenSection?.();
    };
  }, []);

  if (store.loading) {
    return <SettingsLoadingState />;
  }

  if (!store.settings) {
    const fallbackLocale = resolveUiLocale(
      "system",
      typeof navigator === "undefined" ? "en" : navigator.language,
    );
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-8 text-sm text-destructive">
        {store.loadError ?? t(fallbackLocale, "settings.loadFailed")}
      </div>
    );
  }

  const locale = resolveUiLocale(store.settings.ui_locale, navigator.language);

  if (!store.settings.api_key_set || onboardingActive) {
    if (!store.platformInfo) {
      return <SettingsLoadingState />;
    }
    return (
      <div data-settings-route="onboarding">
        <Onboarding
          settings={store.settings}
          devices={store.devices}
          platformInfo={store.platformInfo}
          locale={locale}
          connectApiKey={connectApiKeyForOnboarding}
          onUpdateImmediate={store.updateImmediate}
          onRefreshDevices={store.refreshDevices}
          onMicTestStart={store.startMicTest}
          onMicTestStop={store.stopMicTest}
          onSetShortcut={settingsApi.setShortcut}
          onSetProcessShortcut={settingsApi.setProcessShortcut}
          onSetCancelShortcut={settingsApi.setCancelShortcut}
          onSetHistoryShortcut={settingsApi.setHistoryShortcut}
          onSetSettingsShortcut={settingsApi.setSettingsShortcut}
          onShortcutCommitted={store.replaceSettings}
          onTryNow={toggleOverlay}
          onComplete={async () => {
            await refreshPublicSettings();
            setOnboardingActive(false);
          }}
        />
      </div>
    );
  }

  return (
    <div data-settings-route="settings">
      <SettingsShell
        section={section}
        onSectionChange={setSection}
        status={store.autosaveStatus}
        locale={locale}
        onRetry={store.retryAutosave}
      >
        {section === "general" ? (
          <GeneralSection
            settings={store.settings}
            platformInfo={store.platformInfo}
            devices={store.devices}
            locale={locale}
            onUpdateImmediate={store.updateImmediate}
            onTryVoice={toggleOverlay}
          />
        ) : null}
        {section === "voice" ? (
          <VoiceSection
            settings={store.settings}
            devices={store.devices}
            locale={locale}
            onUpdateImmediate={store.updateImmediate}
            onRefreshDevices={store.refreshDevices}
            onMicTestStart={store.startMicTest}
            onMicTestStop={store.stopMicTest}
          />
        ) : null}
        {section === "output" ? (
          <OutputSection
            settings={store.settings}
            locale={locale}
            onUpdateImmediate={store.updateImmediate}
          />
        ) : null}
        {section === "ai_prompt" ? (
          <AiPromptSection
            settings={store.settings}
            locale={locale}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            onConnect={connectApiKey}
            onDisconnect={disconnectApiKey}
            onLoadModels={loadModels}
            onUpdateImmediate={store.updateImmediate}
            onUpdateDebounced={store.updateDebounced}
          />
        ) : null}
        {section === "shortcut" && store.platformInfo ? (
          <ShortcutSection
            settings={store.settings}
            platformInfo={store.platformInfo}
            locale={locale}
            onSetShortcut={settingsApi.setShortcut}
            onSetProcessShortcut={settingsApi.setProcessShortcut}
            onSetCancelShortcut={settingsApi.setCancelShortcut}
            onSetHistoryShortcut={settingsApi.setHistoryShortcut}
            onSetSettingsShortcut={settingsApi.setSettingsShortcut}
            onCommitted={store.replaceSettings}
            onUpdateImmediate={store.updateImmediate}
          />
        ) : null}
        {section === "history" ? (
          <HistorySection
            enabled={store.settings.show_history}
            locale={locale}
            onEnabledChange={(enabled) => store.updateImmediate({ show_history: enabled })}
            onOpen={settingsApi.openHistory}
            onClear={settingsApi.historyClear}
          />
        ) : null}
      </SettingsShell>
    </div>
  );
}
