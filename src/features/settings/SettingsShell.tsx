import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import { SettingsSidebar, type SettingsSection } from "./SettingsSidebar";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const titleKey: Record<SettingsSection, Parameters<typeof t>[1]> = {
  general: "settings.general",
  voice: "settings.voice",
  ai_prompt: "settings.aiPrompt",
  shortcut: "settings.shortcut",
  output: "settings.output",
  history: "settings.history",
};

export function SettingsShell({
  section,
  onSectionChange,
  status,
  locale,
  onRetry,
  children,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  status: AutosaveStatus;
  locale: UiLocale;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <SettingsSidebar section={section} onSectionChange={onSectionChange} locale={locale} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[608px] px-6 py-6">
          <header className="mb-5 flex min-h-8 items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight">{t(locale, titleKey[section])}</h1>
            <div className="min-h-7 text-xs text-muted-foreground" aria-live="polite">
              {status === "saving" ? t(locale, "settings.saving") : null}
              {status === "saved" ? t(locale, "settings.saved") : null}
              {status === "error" ? (
                <span className="flex items-center gap-2 text-destructive">
                  {t(locale, "settings.saveFailed")}
                  <Button size="sm" variant="ghost" onClick={onRetry}>
                    {t(locale, "settings.retry")}
                  </Button>
                </span>
              ) : null}
            </div>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
