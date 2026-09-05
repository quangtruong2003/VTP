import { useCallback, useEffect, useState } from "react";
import { resolveUiLocale } from "@/lib/i18n";
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
import { onHistoryChanged, onSettingsSection, settingsApi } from "@/lib/settings";
import type { GeminiModelInfo, HistoryEntry } from "@/lib/types";

export function SettingsApp() {
  const store = useSettingsStore();
  const [section, setSection] = useState<SettingsSection>("general");
  const [models, setModels] = useState<GeminiModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);

  const refreshPublicSettings = useCallback(async () => {
    store.replaceSettings(await settingsApi.get());
  }, [store.replaceSettings]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      setModels(await settingsApi.listModels());
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const connectApiKey = useCallback(
    async (key: string) => {
      await settingsApi.connectApiKey(key);
      await refreshPublicSettings();
    },
    [refreshPublicSettings],
  );
  const connectApiKeyForOnboarding = useCallback(
    (key: string) => settingsApi.connectApiKey(key),
    [],
  );

  const disconnectApiKey = useCallback(async () => {
    await settingsApi.deleteApiKey();
    setModels([]);
    await refreshPublicSettings();
  }, [refreshPublicSettings]);

  const refreshHistory = useCallback(async () => {
    setHistoryEntries(await settingsApi.historyList());
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenHistory: (() => void) | undefined;
    let unlistenSection: (() => void) | undefined;

    void settingsApi.historyList().then((entries) => {
      if (!disposed) setHistoryEntries(entries);
    });
    void onHistoryChanged(() => {
      if (!disposed) void refreshHistory();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenHistory = unlisten;
    });
    void onSettingsSection((target) => {
      if (!disposed && target === "history") setSection("history");
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenSection = unlisten;
    });

    return () => {
      disposed = true;
      unlistenHistory?.();
      unlistenSection?.();
    };
  }, [refreshHistory]);

  if (store.loading) {
    return <div className="h-screen w-screen bg-background" aria-busy="true" />;
  }

  if (!store.settings) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-8 text-sm text-destructive">
        {store.loadError ?? "Unable to load settings"}
      </div>
    );
  }

  const locale = resolveUiLocale(store.settings.ui_locale, navigator.language);

  if (!store.settings.api_key_set) {
    if (!store.platformInfo) {
      return <div className="h-screen w-screen bg-background" aria-busy="true" />;
    }
    return (
      <div data-settings-route="onboarding">
        <Onboarding
          settings={store.settings}
          devices={store.devices}
          micLevel={store.micLevel}
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
          onShortcutCommitted={store.replaceSettings}
          onTryNow={() => void overlayApi.toggle()}
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
            onTryVoice={() => void overlayApi.toggle()}
          />
        ) : null}
        {section === "voice" ? (
          <VoiceSection
            settings={store.settings}
            devices={store.devices}
            micLevel={store.micLevel}
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
            onCommitted={store.replaceSettings}
          />
        ) : null}
        {section === "history" ? (
          <HistorySection
            entries={historyEntries}
            locale={locale}
            onCopy={settingsApi.historyCopy}
            onClear={async () => {
              await settingsApi.historyClear();
              setHistoryEntries([]);
            }}
          />
        ) : null}
      </SettingsShell>
    </div>
  );
}
