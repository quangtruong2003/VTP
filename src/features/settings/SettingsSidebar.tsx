import { useEffect, useState } from "react";
import {
  AudioLines,
  Bot,
  History,
  Keyboard,
  Settings2,
  TextCursorInput,
} from "lucide-react";
import { t, type UiLocale } from "@/lib/i18n";
import { settingsApi } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { UpdateDialog } from "./UpdateDialog";

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

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; version: string; url: string }
  | { kind: "error" };

export function SettingsSidebar({
  section,
  onSectionChange,
  locale,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  locale: UiLocale;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({ kind: "idle" });
  const [updateDialog, setUpdateDialog] = useState<{ latest: string; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    settingsApi
      .appVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const checkForUpdates = () => {
    if (update.kind === "checking") return;
    setUpdate({ kind: "checking" });
    settingsApi
      .checkUpdate()
      .then((info) => {
        if (info.update_available) {
          setUpdate({ kind: "available", version: info.latest_version, url: info.release_url });
          setUpdateDialog({ latest: info.latest_version, url: info.release_url });
        } else {
          setUpdate({ kind: "latest" });
        }
      })
      .catch(() => setUpdate({ kind: "error" }));
  };

  return (
    <nav aria-label={t(locale, "settings.navigation")} className="flex w-40 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/90 px-2 py-3.5 select-none">
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
      <div className="mt-auto space-y-1 px-2 pt-3 text-[11px] leading-4">
        {version ? <div className="text-zinc-500">v{version}</div> : null}
        {update.kind === "available" ? (
          <div className="space-y-1">
            <div className="text-amber-300">
              {t(locale, "settings.updateAvailable", { version: update.version })}
            </div>
            <button
              type="button"
              onClick={() => setUpdateDialog({ latest: update.version, url: update.url })}
              className="text-zinc-200 underline underline-offset-2 hover:text-white"
            >
              {t(locale, "settings.viewUpdate")}
            </button>
          </div>
        ) : null}
        {update.kind === "latest" ? (
          <div className="text-zinc-500">{t(locale, "settings.upToDate")}</div>
        ) : null}
        {update.kind === "error" ? (
          <div className="text-red-400/90">{t(locale, "settings.updateCheckFailed")}</div>
        ) : null}
        {update.kind !== "available" ? (
          <button
            type="button"
            onClick={checkForUpdates}
            disabled={update.kind === "checking"}
            className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline disabled:opacity-60"
          >
            {t(locale, update.kind === "checking" ? "settings.checkingUpdates" : "settings.checkForUpdates")}
          </button>
        ) : null}
      </div>
      {updateDialog ? (
        <UpdateDialog
          latestVersion={updateDialog.latest}
          releaseUrl={updateDialog.url}
          locale={locale}
          onClose={() => setUpdateDialog(null)}
        />
      ) : null}
    </nav>
  );
}
