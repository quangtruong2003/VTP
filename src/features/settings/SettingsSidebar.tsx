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
    <nav aria-label="Settings" className="w-40 shrink-0 border-r border-zinc-800 bg-zinc-950/90 px-2 py-3.5 select-none">
      <div className="mb-3 px-2 text-[11px] font-semibold tracking-wide text-zinc-400">
        VoiceToPrompt
      </div>
      <div className="space-y-0.5">
        {sections.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            aria-current={section === id ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400",
              section === id
                ? "bg-zinc-800 text-zinc-100 font-medium shadow-xs"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t(locale, key)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
