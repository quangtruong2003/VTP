import {
  AudioLines,
  Bot,
  History,
  Keyboard,
  Settings2,
  TextCursorInput,
} from "lucide-react";
import { t, type UiLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type SettingsSection =
  | "general"
  | "voice"
  | "ai_prompt"
  | "shortcut"
  | "output"
  | "history";

const sections = [
  { id: "general", icon: Settings2, key: "settings.general" },
  { id: "voice", icon: AudioLines, key: "settings.voice" },
  { id: "ai_prompt", icon: Bot, key: "settings.aiPrompt" },
  { id: "shortcut", icon: Keyboard, key: "settings.shortcut" },
  { id: "output", icon: TextCursorInput, key: "settings.output" },
  { id: "history", icon: History, key: "settings.history" },
] as const;

export function SettingsSidebar({
  section,
  onSectionChange,
  locale,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  locale: UiLocale;
}) {
  return (
    <nav aria-label="Settings" className="w-48 shrink-0 border-r border-border bg-sidebar/80 px-3 py-5">
      <div className="mb-5 px-2 text-xs font-semibold tracking-wide text-muted-foreground">
        VoiceToPrompt
      </div>
      <div className="space-y-1">
        {sections.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            aria-current={section === id ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              section === id
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{t(locale, key)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
