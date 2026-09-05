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
      <div className="flex h-full items-center gap-2.5 px-3.5 select-none">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0 text-xs font-medium leading-none text-zinc-100">
          {t(locale, "overlay.inserted")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3 select-none">
      <div>
        <div className="text-xs font-semibold text-zinc-100">{t(locale, "overlay.notInserted")}</div>
        {copied ? <div className="mt-0.5 text-[10px] text-zinc-400">{t(locale, "overlay.copied")}</div> : null}
      </div>
      <div className="line-clamp-2 flex-1 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs leading-[16px] text-zinc-200">
        {text}
      </div>
      <div className="mt-auto flex items-center justify-end gap-1">
        <Button size="sm" variant="default" className="h-7 px-2.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-zinc-200" onClick={onCopy} aria-label={t(locale, "overlay.copy")}>
          <Copy className="size-3.5" /> {t(locale, "overlay.copy")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={onRetry} aria-label={t(locale, "overlay.retry")}>
          <RefreshCw className="size-3.5" /> {t(locale, "overlay.retry")}
        </Button>
        <Button size="icon" variant="ghost" className="size-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={onHide} aria-label={t(locale, "overlay.close")}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
