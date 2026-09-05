import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";

export function ProcessingState({
  locale,
  elapsedMs,
  showHint,
  showCancel,
  onCancel,
}: {
  locale: UiLocale;
  elapsedMs: number;
  showHint: boolean;
  showCancel: boolean;
  onCancel: () => void;
}) {
  const long = elapsedMs >= 8_000;
  return (
    <div className="flex h-full items-center gap-3 px-4">
      <div aria-hidden="true" className="flex h-7 items-center gap-1">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="overlay-processing-bar h-3.5 w-1 rounded-full bg-primary/80"
            style={{ animationDelay: `${index * 85}ms` }}
          />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{t(locale, "overlay.processing")}</div>
        {showHint ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {t(locale, long ? "overlay.processingLong" : "overlay.processingHint")}
          </div>
        ) : null}
      </div>
      {showCancel ? (
        <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={onCancel}>
          {t(locale, "overlay.cancel")}
        </Button>
      ) : null}
    </div>
  );
}
