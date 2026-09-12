import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import { SectionCard } from "@/components/section-card";
import { SettingRow } from "@/components/setting-row";
import { Switch } from "@/components/ui/switch";
import { t, type UiLocale } from "@/lib/i18n";
import type { FrontendError } from "@/lib/types";

function toFrontendError(value: unknown): FrontendError {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Partial<FrontendError>;
    if (typeof candidate.code === "string" && typeof candidate.recoverable === "boolean") {
      return candidate as FrontendError;
    }
  }

  return {
    code: "unknown",
    recoverable: true,
    detail: value instanceof Error ? value.message : String(value),
  };
}

export function HistorySection({
  enabled,
  locale,
  onEnabledChange,
  onOpen,
  onClear,
}: {
  enabled: boolean;
  locale: UiLocale;
  onEnabledChange: (enabled: boolean) => void;
  onOpen: () => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<FrontendError | null>(null);

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    setOpenError(false);
    try {
      await onOpen();
    } catch {
      setOpenError(true);
    } finally {
      setOpening(false);
    }
  };

  const handleClear = async () => {
    if (clearing) return;
    setClearError(null);
    setClearing(true);
    try {
      await onClear();
      setOpen(false);
    } catch (error) {
      setClearError(toFrontendError(error));
    } finally {
      setClearing(false);
    }
  };

  return (
    <SectionCard>
      <div className="divide-y divide-border/70">
        <SettingRow
          label={t(locale, "settings.saveHistory")}
          description={t(locale, "settings.saveHistoryDesc")}
        >
          <Switch
            aria-label={t(locale, "settings.saveHistory")}
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </SettingRow>

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <div className="text-sm font-medium">{t(locale, "settings.historyWindow")}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t(locale, "settings.historyWindowDesc")}
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void handleOpen()} disabled={opening} aria-busy={opening}>
            {opening ? t(locale, "settings.openingHistory") : t(locale, "settings.openHistory")}
          </Button>
        </div>
        {openError ? <InlineNotice tone="error">{t(locale, "settings.openHistoryFailed")}</InlineNotice> : null}

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <div className="text-sm font-medium">{t(locale, "settings.clearHistory")}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t(locale, "settings.clearHistoryDesc")}
            </div>
          </div>

          <AlertDialog.Root
            open={open}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && clearing) return;
              setOpen(nextOpen);
              if (nextOpen) setClearError(null);
            }}
          >
            <AlertDialog.Trigger
              type="button"
              className={buttonVariants({ variant: "destructive", size: "sm" })}
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

                {clearError ? (
                  <div
                    role="alert"
                    aria-live="assertive"
                    data-error-code={clearError.code}
                    className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <div className="font-medium">{t(locale, "settings.clearHistoryFailed")}</div>
                    {clearError.detail ? <div className="mt-1 break-words">{clearError.detail}</div> : null}
                  </div>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                  <AlertDialog.Cancel
                    className={buttonVariants({ variant: "ghost" })}
                    disabled={clearing}
                    aria-busy={clearing}
                  >
                    {t(locale, "settings.cancelClear")}
                  </AlertDialog.Cancel>
                  <AlertDialog.Action
                    className={buttonVariants({ variant: "destructive" })}
                    disabled={clearing}
                    aria-busy={clearing}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleClear();
                    }}
                  >
                    {t(locale, "settings.confirmClear")}
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      </div>
    </SectionCard>
  );
}
