import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import type { ProcessingStatus } from "@/lib/types";

export function ProcessingState({
  locale,
  elapsedMs,
  showHint,
  showCancel,
  onCancel,
  status,
  model,
}: {
  locale: UiLocale;
  elapsedMs: number;
  showHint: boolean;
  showCancel: boolean;
  onCancel: () => void;
  status?: ProcessingStatus;
  model?: string | null;
}) {
  const long = status === "long_running" || elapsedMs >= 8_000;
  const statusKey = status === "encoding"
    ? "overlay.encoding"
    : status === "fallback"
      ? "overlay.fallback"
      : long
        ? "overlay.processingLong"
        : "overlay.processing";
  return (
    <div className="flex h-full items-center gap-2.5 px-3.5 select-none">
      <div aria-hidden="true" className="flex h-6 items-center gap-1">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="overlay-processing-bar h-3 w-1 rounded-full bg-zinc-100/90"
            style={{ animationDelay: `${index * 85}ms` }}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div role="status" aria-live="polite" className="text-xs font-medium text-zinc-100 truncate">
          {t(locale, statusKey)}
        </div>
        {showHint && status === "fallback" && model ? (
          <div className="text-[10px] text-zinc-400 truncate">
            {t(locale, "overlay.fallbackModel", { model })}
          </div>
        ) : showHint && !long ? (
          <div className="text-[10px] text-zinc-400 truncate">
            {t(locale, "overlay.processingHint")}
          </div>
        ) : null}
      </div>
      {showCancel ? (
        <Button size="sm" variant="ghost" className="h-7 rounded-full px-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={onCancel}>
          {t(locale, "overlay.cancel")}
        </Button>
      ) : null}
    </div>
  );
}
