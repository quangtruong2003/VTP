import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Clipboard, Clock3, History } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import type { HistoryEntry } from "@/lib/types";

function relativeTime(value: string, locale: UiLocale) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absolute < 60) return formatter.format(diffSeconds, "second");
  const minutes = Math.round(diffSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function durationLabel(durationMs: number) {
  if (durationMs < 60_000) return `${Math.max(0.1, durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function HistorySection({
  entries,
  locale,
  onCopy,
  onClear,
}: {
  entries: HistoryEntry[];
  locale: UiLocale;
  onCopy: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card/30 px-8 text-center">
        <div className="mb-3 rounded-full border border-border bg-secondary p-3 text-muted-foreground">
          <History className="size-5" aria-hidden="true" />
        </div>
        <h2 className="text-sm font-semibold">{t(locale, "settings.noContentYet")}</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          {t(locale, "settings.noContentYetDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AlertDialog.Root>
          <AlertDialog.Trigger
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t(locale, "settings.clearHistory")}
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-2xl outline-none">
              <AlertDialog.Title className="text-base font-semibold text-foreground">
                {t(locale, "settings.clearHistoryTitle")}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
                {t(locale, "settings.clearHistoryDesc")}
              </AlertDialog.Description>
              <div className="mt-5 flex justify-end gap-2">
                <AlertDialog.Cancel className={buttonVariants({ variant: "ghost" })}>
                  {t(locale, "settings.cancelClear")}
                </AlertDialog.Cancel>
                <AlertDialog.Action
                  className={buttonVariants({ variant: "destructive" })}
                  onClick={() => void onClear()}
                >
                  {t(locale, "settings.confirmClear")}
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card/55">
        {entries.map((entry, index) => (
          <article
            key={entry.id}
            className={`group relative px-4 py-4 ${index ? "border-t border-border/70" : ""}`}
          >
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{relativeTime(entry.created_at, locale)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3" aria-hidden="true" />
                    {durationLabel(entry.duration_ms)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{entry.model}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-foreground">
                  {entry.response_text}
                </p>
              </div>
              <button
                type="button"
                aria-label={t(locale, "settings.copyResult")}
                onClick={() => void onCopy(entry.id)}
                className="rounded-md p-2 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              >
                <Clipboard className="size-4" aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
