import { Check, Copy, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";

export function SuccessState({
  text,
  pasted,
  copied,
  locale,
  onCopy,
  onRetry,
  onHide,
}: {
  text: string;
  pasted: boolean;
  copied: boolean;
  locale: UiLocale;
  onCopy: () => void;
  onRetry: () => void;
  onHide: () => void;
}) {
  if (pasted) {
    return (
      <div className="flex h-full items-center gap-2.5 px-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0 text-[13px] font-medium leading-none text-foreground">
          {t(locale, "overlay.inserted")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 py-3.5">
      <div>
        <div className="text-[13px] font-semibold text-foreground">{t(locale, "overlay.notInserted")}</div>
        {copied ? <div className="mt-0.5 text-[11px] text-muted-foreground">{t(locale, "overlay.copied")}</div> : null}
      </div>
      <div className="line-clamp-3 whitespace-pre-wrap rounded-lg border border-border bg-secondary/45 px-2.5 py-2 text-[13px] leading-[18px] text-foreground/95">
        {text}
      </div>
      <div className="mt-auto flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onCopy} aria-label={t(locale, "overlay.copy")}>
          <Copy className="size-3.5" /> {t(locale, "overlay.copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry} aria-label={t(locale, "overlay.retry")}>
          <RefreshCw className="size-3.5" /> {t(locale, "overlay.retry")}
        </Button>
        <Button size="icon" variant="ghost" onClick={onHide} aria-label={t(locale, "overlay.close")}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
