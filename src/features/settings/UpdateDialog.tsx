import { useEffect, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { buttonVariants } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type DialogPhase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "working"; progress: number | null }
  | { kind: "installing" }
  | { kind: "done" }
  | { kind: "failed" };

export function UpdateDialog({
  latestVersion,
  releaseUrl,
  locale,
  onClose,
}: {
  latestVersion: string;
  releaseUrl: string;
  locale: UiLocale;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<DialogPhase>({ kind: "loading" });
  const [notes, setNotes] = useState<string | null>(null);
  const pendingRef = useRef<Update | null>(null);
  const totalRef = useRef<number | null>(null);
  const downloadedRef = useRef(0);

  useEffect(() => {
    let active = true;
    check()
      .then((found) => {
        if (!active) return;
        if (found) {
          pendingRef.current = found;
          setNotes(found.body ?? null);
          setPhase({ kind: "ready" });
        } else {
          setPhase({ kind: "failed" });
        }
      })
      .catch(() => {
        if (active) setPhase({ kind: "failed" });
      });
    return () => {
      active = false;
    };
  }, []);

  const busy = phase.kind === "working" || phase.kind === "installing";

  const startUpdate = async () => {
    const pending = pendingRef.current;
    if (!pending || phase.kind !== "ready") return;
    totalRef.current = null;
    downloadedRef.current = 0;
    setPhase({ kind: "working", progress: null });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalRef.current = event.data.contentLength ?? null;
          downloadedRef.current = 0;
          setPhase({ kind: "working", progress: 0 });
        } else if (event.event === "Progress") {
          downloadedRef.current += event.data.chunkLength;
          const total = totalRef.current;
          setPhase({
            kind: "working",
            progress: total ? Math.min(99, Math.round((downloadedRef.current / total) * 100)) : null,
          });
        } else {
          setPhase({ kind: "installing" });
        }
      });
    } catch {
      setPhase({ kind: "failed" });
      return;
    }
    setPhase({ kind: "done" });
    await relaunch().catch(() => {});
  };

  return (
    <AlertDialog.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-2xl outline-none">
          <AlertDialog.Title className="text-base font-semibold text-foreground">
            {t(locale, "settings.updateDialogTitle", { version: latestVersion })}
          </AlertDialog.Title>

          {phase.kind === "ready" && notes ? (
            <AlertDialog.Description className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {notes}
            </AlertDialog.Description>
          ) : null}

          {phase.kind === "working" ? (
            <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
              <div className="text-xs text-muted-foreground">
                {t(locale, "settings.downloading")}
                {phase.progress !== null ? ` ${phase.progress}%` : ""}
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase.progress ?? undefined}
              >
                <div
                  className={cn(
                    "h-full rounded-full bg-primary transition-[width]",
                    phase.progress === null && "w-1/3 animate-pulse",
                  )}
                  style={phase.progress !== null ? { width: `${phase.progress}%` } : undefined}
                />
              </div>
            </div>
          ) : null}
          {phase.kind === "installing" ? (
            <div role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
              {t(locale, "settings.installing")}
            </div>
          ) : null}
          {phase.kind === "done" ? (
            <div role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
              {t(locale, "settings.updateInstalled")}
            </div>
          ) : null}
          {phase.kind === "failed" ? (
            <div className="mt-3 space-y-2">
              <div role="alert" className="text-xs text-destructive">
                {t(locale, "settings.updateFailed")}
              </div>
              <button
                type="button"
                onClick={() => void openUrl(releaseUrl).catch(() => {})}
                className="text-xs text-zinc-200 underline underline-offset-2 hover:text-white"
              >
                {t(locale, "settings.downloadManually")}
              </button>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel className={buttonVariants({ variant: "ghost" })} disabled={busy}>
              {t(locale, "settings.later")}
            </AlertDialog.Cancel>
            {phase.kind === "ready" || phase.kind === "loading" ? (
              <AlertDialog.Action
                className={buttonVariants({ variant: "default" })}
                disabled={phase.kind !== "ready"}
                aria-busy={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void startUpdate();
                }}
              >
                {t(locale, "settings.updateNow")}
              </AlertDialog.Action>
            ) : null}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
