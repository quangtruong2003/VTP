import { useState } from "react";
import { AlertCircle, Copy, RefreshCw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type TranslationKey, type UiLocale } from "@/lib/i18n";
import type { ErrorCode, FrontendError } from "@/lib/types";

const titleKeys: Record<ErrorCode, TranslationKey> = {
  microphone_permission: "error.microphone_permission.title",
  microphone_device: "error.microphone_device.title",
  missing_api_key: "error.missing_api_key.title",
  invalid_api_key: "error.invalid_api_key.title",
  network: "error.network.title",
  model_unavailable: "error.model_unavailable.title",
  shortcut_conflict: "error.shortcut_conflict.title",
  insertion_failed: "error.insertion_failed.title",
  clipboard_failed: "error.clipboard_failed.title",
  unknown: "error.unknown.title",
};

function settingsSectionForError(code: ErrorCode) {
  switch (code) {
    case "microphone_permission":
    case "microphone_device":
      return "voice";
    case "missing_api_key":
    case "invalid_api_key":
    case "model_unavailable":
      return "ai_prompt";
    case "shortcut_conflict":
      return "shortcut";
    default:
      return undefined;
  }
}

export function ErrorState({
  error,
  locale,
  onRetry,
  onStartNewRecording,
  recoveryAction = "retry",
  onOpenSettings,
  onHide,
}: {
  error: FrontendError;
  locale: UiLocale;
  onRetry: () => void;
  onStartNewRecording?: () => void;
  recoveryAction?: "retry" | "copy";
  onOpenSettings: (section?: string) => void;
  onHide: () => void;
}) {
  const [startingNewRecording, setStartingNewRecording] = useState(false);
  const settingsSection = settingsSectionForError(error.code);
  const settingsAction = settingsSection !== undefined;
  const copyAction = recoveryAction === "copy" && !settingsAction;
  const canStartNewRecording = error.recoverable && ![
    "microphone_permission",
    "microphone_device",
    "shortcut_conflict",
  ].includes(error.code);
  const startNewRecording = async () => {
    if (!onStartNewRecording || startingNewRecording) return;
    setStartingNewRecording(true);
    try {
      await onStartNewRecording();
    } finally {
      setStartingNewRecording(false);
    }
  };
  return (
    <div className="flex h-full flex-col gap-2 p-3 select-none" role="alert" aria-live="assertive">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-500/15 text-red-400">
          <AlertCircle className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-zinc-100">{t(locale, titleKeys[error.code])}</div>
          {error.detail ? (
            <details className="mt-1 text-[10px] text-zinc-400">
              <summary className="cursor-pointer select-none">{t(locale, "overlay.details")}</summary>
              <div className="mt-1 max-h-12 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 font-mono text-[10px] leading-4 text-zinc-300">
                {error.detail}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-end gap-1">
        {onStartNewRecording && canStartNewRecording ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={() => void startNewRecording()}
            disabled={startingNewRecording}
            aria-busy={startingNewRecording}
          >
            {t(locale, "overlay.newRecording")}
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          onClick={onHide}
          aria-label={t(locale, "overlay.close")}
        >
          <X className="size-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800" onClick={settingsAction ? () => onOpenSettings(settingsSection) : onRetry}>
          {settingsAction ? <Settings2 className="size-3.5" /> : copyAction ? <Copy className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {t(locale, settingsAction ? "overlay.openSettings" : copyAction ? "overlay.copy" : "overlay.retry")}
        </Button>
      </div>
    </div>
  );
}
