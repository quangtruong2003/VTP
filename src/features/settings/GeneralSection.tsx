import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/section-card";
import { SettingRow } from "@/components/setting-row";
import { ShortcutKey } from "@/components/shortcut-key";
import { StatusBadge } from "@/components/status-badge";
import { Switch } from "@/components/ui/switch";
import { t, type UiLocale } from "@/lib/i18n";
import type { AppSettings, AudioDeviceInfo, PlatformInfo } from "@/lib/types";

function shortcutLabels(shortcut: string, platformInfo: PlatformInfo | null) {
  return shortcut.split("+").map((part) => {
    if (part === "CmdOrCtrl") return platformInfo?.primary_modifier || "Ctrl";
    return part;
  });
}

export function GeneralSection({
  settings,
  platformInfo,
  devices,
  locale,
  onUpdateImmediate,
  onTryVoice,
}: {
  settings: AppSettings;
  platformInfo: PlatformInfo | null;
  devices: AudioDeviceInfo[];
  locale: UiLocale;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
  onTryVoice: () => void;
}) {
  const selectedDevice = settings.device_name
    ? devices.find((device) => device.name === settings.device_name)?.name ?? settings.device_name
    : t(locale, "settings.systemDefault");

  return (
    <div className="space-y-3.5">
      <SectionCard title={t(locale, "settings.readiness")}>
        <div className="divide-y divide-border/70">
          <SettingRow label="Gemini">
            <StatusBadge tone={settings.api_key_set ? "success" : "warning"}>
              {t(locale, settings.api_key_set ? "settings.geminiConnected" : "settings.geminiNeedsSetup")}
            </StatusBadge>
          </SettingRow>
          <SettingRow label={t(locale, "settings.microphone")}>
            <span className="text-xs text-muted-foreground">{selectedDevice}</span>
          </SettingRow>
          <SettingRow label={t(locale, "settings.shortcut")}>
            <span className="flex items-center gap-1.5">
              {shortcutLabels(settings.shortcut, platformInfo).map((label, index) => (
                <ShortcutKey key={`${label}-${index}`} label={label} />
              ))}
            </span>
          </SettingRow>
          <SettingRow label={t(locale, "settings.output")}>
            <StatusBadge tone={settings.paste_automatically ? "success" : "neutral"}>
              {t(locale, settings.paste_automatically ? "settings.autoInsertOn" : "settings.autoInsertOff")}
            </StatusBadge>
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="divide-y divide-border/70">
          <SettingRow
            label={t(locale, "settings.startWithWindows")}
            description={t(locale, "settings.startWithWindowsDesc")}
          >
            <Switch
              aria-label={t(locale, "settings.startWithWindows")}
              checked={Boolean(settings.start_with_windows)}
              onCheckedChange={(checked) =>
                onUpdateImmediate({ start_with_windows: checked })
              }
            />
          </SettingRow>
          <SettingRow label={t(locale, "settings.uiLanguage")}>
            <select
              aria-label={t(locale, "settings.uiLanguage")}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={settings.ui_locale}
              onChange={(event) =>
                onUpdateImmediate({
                  ui_locale: event.target.value as AppSettings["ui_locale"],
                })
              }
            >
              <option value="system">{t(locale, "settings.followSystem")}</option>
              <option value="vi">{t(locale, "settings.vietnamese")}</option>
              <option value="en">{t(locale, "settings.english")}</option>
            </select>
          </SettingRow>
        </div>
      </SectionCard>

      <Button type="button" size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={onTryVoice}>
        {t(locale, "settings.tryVoice")}
      </Button>
    </div>
  );
}
