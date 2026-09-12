import { InlineNotice } from "@/components/inline-notice";
import { SectionCard } from "@/components/section-card";
import { SettingRow } from "@/components/setting-row";
import { Switch } from "@/components/ui/switch";
import { t, type UiLocale } from "@/lib/i18n";
import type { AppSettings } from "@/lib/types";

export function OutputSection({
  settings,
  locale,
  onUpdateImmediate,
}: {
  settings: AppSettings;
  locale: UiLocale;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <SectionCard>
      <div className="divide-y divide-border/70">
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
        <SettingRow
          label={t(locale, "settings.keepClipboard")}
          description={t(locale, "settings.keepClipboardDesc")}
        >
          <Switch
            aria-label={t(locale, "settings.keepClipboard")}
            checked={settings.copy_to_clipboard}
            onCheckedChange={(checked) =>
              onUpdateImmediate(
                !checked && !settings.paste_automatically
                  ? { copy_to_clipboard: false, paste_automatically: true }
                  : { copy_to_clipboard: checked },
              )
            }
          />
        </SettingRow>
        {!settings.copy_to_clipboard ? (
          <InlineNotice tone="warning" className="my-3">
            {t(locale, "settings.clipboardOffRecovery")}
          </InlineNotice>
        ) : null}
      </div>
    </SectionCard>
  );
}
