import { AlertCircle, RefreshCw, Settings2, X } from "lucide-react";
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

function shouldOpenSettings(code: ErrorCode) {
  return [
    "microphone_permission",
    "microphone_device",
    "missing_api_key",
    "invalid_api_key",
    "shortcut_conflict",
  ].includes(code);
}

export function ErrorState({
  error,
  locale,
  onRetry,
  onOpenSettings,
  onHide,
}: {
  error: FrontendError;
  locale: UiLocale;
  onRetry: () => void;
  onOpenSettings: () => void;
  onHide: () => void;
}) {
  const settingsAction = shouldOpenSettings(error.code);
  return (
    <div className="flex h-full flex-col gap-2 p-3 select-none">
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
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          onClick={onHide}
          aria-label={t(locale, "overlay.close")}
        >
          <X className="size-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800" onClick={settingsAction ? onOpenSettings : onRetry}>
          {settingsAction ? <Settings2 className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {t(locale, settingsAction ? "overlay.openSettings" : "overlay.retry")}
        </Button>
      </div>
    </div>
  );
}
