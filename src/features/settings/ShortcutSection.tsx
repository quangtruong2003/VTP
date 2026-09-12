import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { InlineNotice } from "@/components/inline-notice";
import { SectionCard } from "@/components/section-card";
import { ShortcutKey } from "@/components/shortcut-key";
import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import type { AppSettings, PlatformInfo, PublicSettings } from "@/lib/types";
import {
  candidateFromKeyboardEvent,
  displayShortcut,
  toTauriAccelerator,
  validateCandidate,
} from "./shortcut";

type CaptureError = "missing_modifier" | "unsupported" | "conflict" | null;
type ShortcutKind = "record" | "process" | "cancel" | "history" | "settings";
type ShortcutSetter = (shortcut: string) => Promise<PublicSettings>;

function conflictHintKey(os: PlatformInfo["os"]) {
  if (os === "macos") return "settings.shortcutConflictMac" as const;
  if (os === "windows") return "settings.shortcutConflictWindows" as const;
  return "settings.shortcutConflictLinux" as const;
}

const isGlobalShortcut = (kind: ShortcutKind) => {
  return kind === "record" || kind === "history" || kind === "settings";
};

export function ShortcutSection({
  settings,
  platformInfo,
  locale,
  onSetShortcut,
  onSetProcessShortcut,
  onSetCancelShortcut,
  onSetHistoryShortcut,
  onSetSettingsShortcut,
  onCommitted,
  onUpdateImmediate,
}: {
  settings: AppSettings;
  platformInfo: PlatformInfo;
  locale: UiLocale;
  onSetShortcut: ShortcutSetter;
  onSetProcessShortcut: ShortcutSetter;
  onSetCancelShortcut: ShortcutSetter;
  onSetHistoryShortcut: ShortcutSetter;
  onSetSettingsShortcut: ShortcutSetter;
  onCommitted: (snapshot: PublicSettings) => void;
  onUpdateImmediate: (patch: Partial<AppSettings>) => void;
}) {
  const [displayed, setDisplayed] = useState({
    record: settings.shortcut,
    process: settings.process_shortcut,
    cancel: settings.cancel_shortcut,
    history: settings.history_shortcut ?? "Alt+V",
    settings: settings.settings_shortcut ?? "Alt+S",
  });
  const [capturing, setCapturing] = useState<ShortcutKind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CaptureError>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDisplayed({
      record: settings.shortcut,
      process: settings.process_shortcut,
      cancel: settings.cancel_shortcut,
      history: settings.history_shortcut ?? "Alt+V",
      settings: settings.settings_shortcut ?? "Alt+S",
    });
  }, [
    settings.shortcut,
    settings.process_shortcut,
    settings.cancel_shortcut,
    settings.history_shortcut,
    settings.settings_shortcut,
  ]);

  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  const startCapture = (kind: ShortcutKind) => {
    setError(null);
    setCapturing(kind);
  };

  const cancelCapture = () => {
    if (pending) return;
    setError(null);
    setCapturing(null);
  };

  const setterFor = (kind: ShortcutKind): ShortcutSetter => {
    if (kind === "process") return onSetProcessShortcut;
    if (kind === "cancel") return onSetCancelShortcut;
    if (kind === "history") return onSetHistoryShortcut;
    if (kind === "settings") return onSetSettingsShortcut;
    return onSetShortcut;
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!capturing || pending) return;
    event.preventDefault();
    event.stopPropagation();

    // Preserve Escape-to-exit for the global system bindings (record, history, settings).
    // For the two session actions (process, cancel), Escape is a valid, configurable shortcut itself.
    if (event.key === "Escape" && isGlobalShortcut(capturing)) {
      cancelCapture();
      return;
    }

    if (event.key === "Enter" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      setError("unsupported");
      return;
    }

    const candidate = candidateFromKeyboardEvent(event.nativeEvent);
    const validation = validateCandidate(candidate, {
      allowUnmodified: !isGlobalShortcut(capturing),
    });
    if (!validation.ok) {
      if (validation.reason === "modifier_only") return;
      setError(validation.reason);
      return;
    }

    const accelerator = toTauriAccelerator(candidate, platformInfo.os);
    const kind = capturing;
    setPending(true);
    setError(null);
    try {
      const snapshot = await setterFor(kind)(accelerator);
      setDisplayed({
        record: snapshot.shortcut,
        process: snapshot.process_shortcut,
        cancel: snapshot.cancel_shortcut,
        history: snapshot.history_shortcut ?? "Alt+V",
        settings: snapshot.settings_shortcut ?? "Alt+S",
      });
      onCommitted(snapshot);
      setCapturing(null);
    } catch {
      setError("conflict");
      setCapturing(null);
    } finally {
      setPending(false);
    }
  };

  const clearShortcut = async (kind: ShortcutKind) => {
    if (pending || kind !== "process") return;
    setPending(true);
    setError(null);
    try {
      const snapshot = await setterFor(kind)("");
      setDisplayed({
        record: snapshot.shortcut,
        process: snapshot.process_shortcut,
        cancel: snapshot.cancel_shortcut,
        history: snapshot.history_shortcut ?? "Alt+V",
        settings: snapshot.settings_shortcut ?? "Alt+S",
      });
      onCommitted(snapshot);
    } catch {
      setError("conflict");
    } finally {
      setPending(false);
    }
  };

  const rows: Array<{
    kind: ShortcutKind;
    label: string;
    description: string;
    value: string;
  }> = [
    {
      kind: "record",
      label: t(locale, "settings.recordShortcut"),
      description: t(locale, "settings.recordShortcutDesc"),
      value: displayed.record,
    },
    {
      kind: "process",
      label: t(locale, "settings.processShortcut"),
      description: t(locale, "settings.processShortcutDesc"),
      value: displayed.process,
    },
    {
      kind: "cancel",
      label: t(locale, "settings.cancelShortcut"),
      description: t(locale, "settings.cancelShortcutDesc"),
      value: displayed.cancel,
    },
    {
      kind: "history",
      label: t(locale, "settings.historyShortcut"),
      description: t(locale, "settings.historyShortcutDesc"),
      value: displayed.history,
    },
    {
      kind: "settings",
      label: t(locale, "settings.settingsShortcut"),
      description: t(locale, "settings.settingsShortcutDesc"),
      value: displayed.settings,
    },
  ];

  return (
    <div className="space-y-4">
      <SectionCard
        title={t(locale, "settings.shortcut")}
        description={t(locale, "settings.shortcutDesc")}
      >
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-secondary/50 p-1" role="group" aria-label={t(locale, "settings.shortcutMode")}>
          {(["toggle", "hold"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={settings.shortcut_mode === mode ? "secondary" : "ghost"}
              aria-pressed={settings.shortcut_mode === mode}
              onClick={() => onUpdateImmediate({ shortcut_mode: mode })}
            >
              {t(locale, mode === "toggle" ? "settings.shortcutModeToggle" : "settings.shortcutModeHold")}
            </Button>
          ))}
        </div>
        <div className="divide-y divide-border/70">
          {rows.map((row) => (
            <div key={row.kind} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{row.label}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {row.description}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    {displayShortcut(row.value, platformInfo.os).map((label, index) => (
                      <ShortcutKey key={`${row.kind}-${label}-${index}`} label={label === "Escape" ? "Esc" : label} />
                    ))}
                  </div>
                  {row.kind === "process" && row.value ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      aria-label={`${t(locale, "settings.clearShortcut")} — ${row.label}`}
                      onClick={() => void clearShortcut(row.kind)}
                      disabled={pending}
                    >
                      {t(locale, "settings.clearShortcut")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    aria-label={`${t(locale, "settings.changeShortcut")} — ${row.label}`}
                    onClick={() => startCapture(row.kind)}
                    disabled={pending}
                  >
                    {t(locale, "settings.changeShortcut")}
                  </Button>
                </div>
              </div>

              {capturing === row.kind ? (
                <div className="mt-2 flex items-center gap-2">
                  <div
                    ref={captureRef}
                    tabIndex={0}
                    role="group"
                    aria-label={`${t(locale, "settings.captureShortcut")} — ${row.label}`}
                    onKeyDown={(event) => void handleKeyDown(event)}
                    className="flex min-h-14 flex-1 items-center gap-2.5 rounded-lg border border-zinc-500/60 bg-zinc-900/90 px-3 py-2 outline-none ring-offset-background focus-visible:ring-1 focus-visible:ring-zinc-400"
                  >
                    <Keyboard className="size-4 text-zinc-200 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{t(locale, "settings.captureShortcut")}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {isGlobalShortcut(row.kind)
                          ? platformInfo.os === "macos"
                            ? "⌘ / ⌥ / ⇧ + key"
                            : "Ctrl / Alt / Shift + key"
                          : "Esc / key combination"}
                      </p>
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelCapture}>
                    {t(locale, "settings.cancelClear")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {error === "missing_modifier" ? (
          <InlineNotice tone="warning">
            {t(locale, "settings.shortcutMissingModifier")}
          </InlineNotice>
        ) : null}
        {error === "unsupported" ? (
          <InlineNotice tone="warning">
            {t(locale, "settings.shortcutUnsupported")}
          </InlineNotice>
        ) : null}
        {error === "conflict" ? (
          <InlineNotice tone="error">
            <div className="font-medium">{t(locale, "error.shortcut_conflict.title")}</div>
            <div className="mt-1 opacity-90">{t(locale, conflictHintKey(platformInfo.os))}</div>
          </InlineNotice>
        ) : null}
      </SectionCard>
    </div>
  );
}
