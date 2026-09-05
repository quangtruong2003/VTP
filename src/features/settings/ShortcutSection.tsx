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
type ShortcutKind = "record" | "process" | "cancel";
type ShortcutSetter = (shortcut: string) => Promise<PublicSettings>;

function conflictHintKey(os: PlatformInfo["os"]) {
  if (os === "macos") return "settings.shortcutConflictMac" as const;
  if (os === "windows") return "settings.shortcutConflictWindows" as const;
  return "settings.shortcutConflictLinux" as const;
}

export function ShortcutSection({
  settings,
  platformInfo,
  locale,
  onSetShortcut,
  onSetProcessShortcut,
  onSetCancelShortcut,
  onCommitted,
}: {
  settings: AppSettings;
  platformInfo: PlatformInfo;
  locale: UiLocale;
  onSetShortcut: ShortcutSetter;
  onSetProcessShortcut: ShortcutSetter;
  onSetCancelShortcut: ShortcutSetter;
  onCommitted: (snapshot: PublicSettings) => void;
}) {
  const [displayed, setDisplayed] = useState({
    record: settings.shortcut,
    process: settings.process_shortcut,
    cancel: settings.cancel_shortcut,
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
    });
  }, [settings.shortcut, settings.process_shortcut, settings.cancel_shortcut]);

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
    return onSetShortcut;
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!capturing || pending) return;
    event.preventDefault();
    event.stopPropagation();

    // Preserve Escape-to-exit for the global record binding. For the two
    // session actions Escape is a valid, configurable shortcut itself.
    if (event.key === "Escape" && capturing === "record") {
      cancelCapture();
      return;
    }

    const candidate = candidateFromKeyboardEvent(event.nativeEvent);
    const validation = validateCandidate(candidate, {
      allowUnmodified: capturing !== "record",
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
  ];

  return (
    <div className="space-y-6">
      <SectionCard
        title={t(locale, "settings.shortcut")}
        description={t(locale, "settings.shortcutDesc")}
      >
        <div className="divide-y divide-border/70">
          {rows.map((row) => (
            <div key={row.kind} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{row.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {row.description}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    {displayShortcut(row.value, platformInfo.os).map((label, index) => (
                      <ShortcutKey key={`${row.kind}-${label}-${index}`} label={label === "Escape" ? "Esc" : label} />
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`${t(locale, "settings.changeShortcut")} — ${row.label}`}
                    onClick={() => startCapture(row.kind)}
                  >
                    {t(locale, "settings.changeShortcut")}
                  </Button>
                </div>
              </div>

              {capturing === row.kind ? (
                <div className="mt-3 flex items-center gap-2">
                  <div
                    ref={captureRef}
                    tabIndex={0}
                    role="group"
                    aria-label={`${t(locale, "settings.captureShortcut")} — ${row.label}`}
                    onKeyDown={(event) => void handleKeyDown(event)}
                    className="flex min-h-20 flex-1 items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Keyboard className="size-5 text-primary" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t(locale, "settings.captureShortcut")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.kind === "record"
                          ? platformInfo.os === "macos"
                            ? "⌘ / ⌥ / ⇧ + key"
                            : "Ctrl / Alt / Shift + key"
                          : "Enter / Esc / key combination"}
                      </p>
                    </div>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={cancelCapture}>
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
