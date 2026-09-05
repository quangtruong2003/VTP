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
    <div className="flex h-full flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-red-400/10 text-red-300">
          <AlertCircle className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">{t(locale, titleKeys[error.code])}</div>
          {error.detail ? (
            <details className="mt-1.5 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none">{t(locale, "overlay.details")}</summary>
              <div className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/45 px-2 py-1.5 font-mono text-[10px] leading-4">
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
          onClick={onHide}
          aria-label={t(locale, "overlay.close")}
        >
          <X className="size-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={settingsAction ? onOpenSettings : onRetry}>
          {settingsAction ? <Settings2 className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {t(locale, settingsAction ? "overlay.openSettings" : "overlay.retry")}
        </Button>
      </div>
    </div>
  );
}
