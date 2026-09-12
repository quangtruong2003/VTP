import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronUp, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import { SectionCard } from "@/components/section-card";
import { SettingRow } from "@/components/setting-row";
import { StatusBadge } from "@/components/status-badge";
import { promptProfileLabel, t, type UiLocale } from "@/lib/i18n";
import type { ApiKeySlot, AppSettings, GeminiModelInfo, PromptProfile } from "@/lib/types";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant. The user speaks to you and their speech is transcribed by the model. Respond with text that can be directly inserted into the application they were typing in. Be concise and match the user's language. Do not add markdown formatting unless asked.";

const RESPONSE_LANGUAGES = [
  ["English", "en"],
  ["Vietnamese", "vi"],
  ["Japanese", "ja"],
  ["Spanish", "es"],
  ["French", "fr"],
  ["German", "de"],
] as const;

const DEFAULT_PROMPT_PROFILES: PromptProfile[] = [
  { id: "raw", name: "Raw", prompt: "Return a faithful transcription with only obvious speech disfluencies removed." },
  { id: "natural", name: "Natural", prompt: "Rewrite the transcript into clear, natural text while preserving the speaker's meaning and tone." },
  { id: "email", name: "Email", prompt: "Turn the transcript into a concise, polished email message." },
  { id: "summary", name: "Summary", prompt: "Summarize the transcript into concise key points." },
  { id: "code", name: "Code", prompt: "Turn the transcript into clean code or a precise coding instruction, preserving technical details." },
];

function localizedLanguageName(locale: UiLocale, languageCode: string, fallback: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(languageCode) ?? fallback;
  } catch {
    return fallback;
  }
}

export function AiPromptSection({
  settings,
  locale,
  models,
  modelsLoading,
  modelsError,
  apiKeys,
  onAddKey,
  onRemoveKey,
  onSetPrimaryKey,
  onLoadModels,
  onUpdateImmediate,
  onUpdateDebounced,
}: {
  settings: AppSettings;
  locale: UiLocale;
  models: GeminiModelInfo[];
  modelsLoading: boolean;
  modelsError?: boolean;
  apiKeys: ApiKeySlot[];
  onAddKey: (key: string) => Promise<void>;
  onRemoveKey: (index: number) => Promise<void>;
  onSetPrimaryKey: (index: number) => Promise<void>;
  onLoadModels: () => Promise<void>;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
  onUpdateDebounced: (patch: Partial<AppSettings>) => void;
}) {
  const connected = apiKeys.length > 0;
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [busyKeyIndex, setBusyKeyIndex] = useState<number | null>(null);
  const [keyOpError, setKeyOpError] = useState(false);
  const [openUrlError, setOpenUrlError] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [customProfileName, setCustomProfileName] = useState("");
  const [customProfilePrompt, setCustomProfilePrompt] = useState("");
  const loadedModels = useRef(false);

  useEffect(() => {
    if (!connected) {
      loadedModels.current = false;
      return;
    }
    if (!loadedModels.current) {
      loadedModels.current = true;
      void onLoadModels();
    }
  }, [connected, onLoadModels]);

  const addKey = async () => {
    const candidate = apiKey.trim();
    if (!candidate || connecting) return;
    setConnecting(true);
    setConnectionError(false);
    try {
      await onAddKey(candidate);
      setApiKey("");
      loadedModels.current = false;
    } catch {
      setConnectionError(true);
    } finally {
      setConnecting(false);
    }
  };

  const runKeyOp = async (index: number, op: (index: number) => Promise<void>) => {
    if (busyKeyIndex !== null) return;
    setKeyOpError(false);
    setBusyKeyIndex(index);
    try {
      await op(index);
    } catch {
      setKeyOpError(true);
    } finally {
      setBusyKeyIndex(null);
    }
  };

  const openApiKeyPage = async () => {
    setOpenUrlError(false);
    try {
      await openUrl("https://aistudio.google.com/app/apikey");
    } catch {
      setOpenUrlError(true);
    }
  };

  const selectedModel = models.find((model) => model.name === settings.model);
  const fallbackList = settings.fallback_models ?? [];
  const activeChain = [settings.model, ...fallbackList];
  const availableForFallback = models.filter((m) => !activeChain.includes(m.name));
  const promptProfiles = settings.prompt_profiles?.length
    ? settings.prompt_profiles
    : DEFAULT_PROMPT_PROFILES;
  const requestedProfileId = settings.prompt_profile_id ?? "natural";
  const selectedProfileId = promptProfiles.some((profile) => profile.id === requestedProfileId)
    ? requestedProfileId
    : "";
  const selectedProfile = promptProfiles.find((profile) => profile.id === selectedProfileId);

  const addFallback = (modelName: string) => {
    const updated = [...fallbackList, modelName];
    onUpdateImmediate({ fallback_models: updated });
  };

  const removeFallback = (indexToRemove: number) => {
    const updated = fallbackList.filter((_, idx) => idx !== indexToRemove);
    onUpdateImmediate({ fallback_models: updated });
  };

  const addCustomProfile = () => {
    const name = customProfileName.trim();
    const prompt = customProfilePrompt.trim();
    if (!name || !prompt) return;
    const id = `custom-${Date.now()}`;
    onUpdateImmediate({
      prompt_profile_id: id,
      prompt_profiles: [...promptProfiles, { id, name, prompt }],
    });
    setCustomProfileName("");
    setCustomProfilePrompt("");
  };

  return (
    <div className="space-y-3.5">
      <SectionCard
        title={t(locale, "settings.aiConnection")}
        description={t(locale, "settings.aiConnectionDesc")}
      >
        <div className="space-y-2.5">
          {connected ? (
            <div className="flex items-center justify-between gap-4">
              <StatusBadge tone="success">{t(locale, "settings.connected")}</StatusBadge>
              <span className="text-[11px] text-muted-foreground">
                {t(locale, "settings.apiKeysDesc")}
              </span>
            </div>
          ) : null}
          {connected ? (
            <div className="space-y-1">
              {apiKeys.map((slot, position) => {
                const busy = busyKeyIndex === slot.index;
                return (
                  <div
                    key={slot.index}
                    className="flex items-center justify-between gap-2.5 rounded-md border border-border/80 bg-background/80 px-2 py-1 text-xs shadow-xs"
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                        {position + 1}
                      </span>
                      <span className="truncate font-medium text-xs">
                        {t(locale, "settings.keyName", { n: position + 1 })}
                      </span>
                      {slot.is_primary ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                          {t(locale, "settings.primary")}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!slot.is_primary ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          disabled={busyKeyIndex !== null}
                          onClick={() => void runKeyOp(slot.index, onSetPrimaryKey)}
                        >
                          {t(locale, "settings.makePrimary")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void runKeyOp(slot.index, onRemoveKey)}
                        disabled={busyKeyIndex !== null}
                        aria-busy={busy}
                        className="h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                        title={t(locale, "settings.remove")}
                      >
                        <Trash2 className="size-3" />
                        <span className="sr-only">{t(locale, "settings.remove")}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {keyOpError ? (
            <InlineNotice tone="error">{t(locale, "settings.keyUpdateFailed")}</InlineNotice>
          ) : null}
          <div className="flex gap-2">
            <input
              type="password"
              aria-label={t(locale, "settings.aiConnection")}
              placeholder="AIza…"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" size="sm" className="h-8 px-3 text-xs" onClick={() => void addKey()} disabled={!apiKey.trim() || connecting} aria-busy={connecting}>
              {connecting
                ? t(locale, "settings.addingKey")
                : connected
                  ? t(locale, "settings.addKey")
                  : t(locale, "settings.connect")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="text-[11px]">{t(locale, "settings.apiKeySecurity")}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={() => void openApiKeyPage()}
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              {t(locale, "settings.getApiKey")}
            </Button>
          </div>
          {connectionError ? (
            <InlineNotice tone="error">{t(locale, "settings.connectionFailed")}</InlineNotice>
          ) : null}
          {openUrlError ? (
            <InlineNotice tone="error">{t(locale, "settings.openApiKeyFailed")}</InlineNotice>
          ) : null}
        </div>
      </SectionCard>

      {connected ? (
        <SectionCard>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="ai-model" className="text-xs font-medium">
                {t(locale, "settings.model")}
              </label>
              <select
                id="ai-model"
                aria-label={t(locale, "settings.model")}
                value={settings.model}
                disabled={modelsLoading || models.length === 0}
                onChange={(event) => onUpdateImmediate({ model: event.target.value })}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {models.length === 0 ? (
                  <option value={settings.model}>
                    {modelsLoading ? t(locale, "settings.loadingModels") : settings.model}
                  </option>
                ) : null}
                {models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.display_name}
                  </option>
                ))}
              </select>
              {selectedModel ? (
                <p className="text-[11px] leading-4 text-muted-foreground">
                  <span className="font-mono">{selectedModel.name}</span>
                  {selectedModel.description ? ` · ${selectedModel.description}` : ""}
                </p>
              ) : null}
              {modelsError ? (
                <InlineNotice tone="error">{t(locale, "settings.modelsUnavailable")}</InlineNotice>
              ) : null}
            </div>

            {/* Fallback models configuration */}
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(locale, "settings.fallbackModels")}
                </label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t(locale, "settings.fallbackModelsDesc")}
                </p>
              </div>

              {fallbackList.length > 0 ? (
                <div className="space-y-1">
                  {fallbackList.map((modelName, index) => {
                    const fallbackInfo = models.find((m) => m.name === modelName);
                    return (
                      <div
                        key={`${modelName}-${index}`}
                        className="flex items-center justify-between gap-2.5 rounded-md border border-border/80 bg-background/80 px-2 py-1 text-xs shadow-xs"
                      >
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <span className="truncate font-medium text-xs">
                              {fallbackInfo?.display_name || modelName}
                            </span>
                            <span className="ml-1 truncate font-mono text-[10px] text-muted-foreground">
                              ({modelName})
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeFallback(index)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                          title={t(locale, "settings.remove")}
                        >
                          <Trash2 className="size-3" />
                          <span className="sr-only">{t(locale, "settings.remove")}</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] italic text-muted-foreground">
                  {t(locale, "settings.noFallbackModels")}
                </p>
              )}

              {availableForFallback.length > 0 ? (
                <div className="pt-0.5">
                  <select
                    aria-label={t(locale, "settings.addFallbackModel")}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        addFallback(e.target.value);
                      }
                    }}
                    className="h-7 w-full rounded-md border border-dashed border-input bg-background/50 px-2 text-xs text-muted-foreground outline-none hover:border-solid hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="" disabled>
                      + {t(locale, "settings.addFallbackModel")}…
                    </option>
                    {availableForFallback.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.display_name} ({model.name})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="prompt-profile" className="text-xs font-medium">
                {t(locale, "settings.promptProfile")}
              </label>
              <select
                id="prompt-profile"
                aria-label={t(locale, "settings.promptProfile")}
                value={selectedProfileId}
                onChange={(event) => onUpdateImmediate({ prompt_profile_id: event.target.value })}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t(locale, "settings.customInstructions")}</option>
                {promptProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {promptProfileLabel(locale, profile.id, profile.name)}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label={t(locale, "settings.customProfileName")}
                  value={customProfileName}
                  onChange={(event) => setCustomProfileName(event.target.value)}
                  placeholder={t(locale, "settings.customProfileName")}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  aria-label={t(locale, "settings.customProfilePrompt")}
                  value={customProfilePrompt}
                  onChange={(event) => setCustomProfilePrompt(event.target.value)}
                  placeholder={t(locale, "settings.customProfilePrompt")}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addCustomProfile} disabled={!customProfileName.trim() || !customProfilePrompt.trim()}>
                {t(locale, "settings.addCustomProfile")}
              </Button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label htmlFor="system-prompt" className="text-xs font-medium">
                    {t(locale, "settings.instructionsForAi")}
                  </label>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {selectedProfile
                      ? t(locale, "settings.profileInstructionsCombined")
                      : t(locale, "settings.instructionsForAiDesc")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => onUpdateDebounced({ system_prompt: DEFAULT_SYSTEM_PROMPT })}
                >
                  {t(locale, "settings.restoreDefault")}
                </Button>
              </div>
              <textarea
                id="system-prompt"
                aria-label={t(locale, "settings.instructionsForAi")}
                rows={4}
                value={settings.system_prompt}
                onChange={(event) => onUpdateDebounced({ system_prompt: event.target.value })}
                className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <SettingRow label={t(locale, "settings.responseLanguage")}>
              <select
                aria-label={t(locale, "settings.responseLanguage")}
                value={settings.language}
                onChange={(event) => onUpdateImmediate({ language: event.target.value })}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="auto">{t(locale, "settings.responseLanguageAuto")}</option>
                {RESPONSE_LANGUAGES.map(([value, code]) => (
                  <option key={value} value={value}>
                    {localizedLanguageName(locale, code, value)}
                  </option>
                ))}
              </select>
            </SettingRow>
          </div>
        </SectionCard>
      ) : null}

      {connected ? (
        <SectionCard>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
          >
            {t(locale, "settings.advanced")}
            {advanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {advanced ? (
            <div className="mt-5 space-y-5 border-t border-border pt-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <label htmlFor="temperature">{t(locale, "settings.temperature")}</label>
                  <span>{settings.temperature.toFixed(2)}</span>
                </div>
                <input
                  id="temperature"
                  aria-label={t(locale, "settings.temperature")}
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={settings.temperature}
                  onChange={(event) =>
                    onUpdateDebounced({ temperature: Number(event.target.value) })
                  }
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{t(locale, "settings.precise")}</span>
                  <span>{t(locale, "settings.creative")}</span>
                </div>
              </div>

              <SettingRow label={t(locale, "settings.maxOutputTokens")}>
                <input
                  aria-label={t(locale, "settings.maxOutputTokens")}
                  type="number"
                  min={64}
                  max={8192}
                  step={64}
                  value={settings.max_output_tokens}
                  onChange={(event) =>
                    onUpdateDebounced({ max_output_tokens: Number(event.target.value) })
                  }
                  className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </SettingRow>

              <div className="space-y-2">
                <label htmlFor="manual-model" className="text-xs font-medium text-muted-foreground">
                  {t(locale, "settings.manualModelId")}
                </label>
                <input
                  id="manual-model"
                  aria-label={t(locale, "settings.manualModelId")}
                  value={settings.model}
                  onChange={(event) => onUpdateDebounced({ model: event.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}
