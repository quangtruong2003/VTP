import { Pause, Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import { VoiceMeter } from "./VoiceMeter";

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RecordingState({
  level,
  elapsedMs,
  shortcut,
  processShortcut,
  cancelShortcut,
  paused,
  locale,
  onTogglePause,
  onProcess,
  onCancel,
}: {
  level: number;
  elapsedMs: number;
  shortcut: string;
  processShortcut: string;
  cancelShortcut: string;
  paused: boolean;
  locale: UiLocale;
  onTogglePause: () => void;
  onProcess: () => void;
  onCancel: () => void;
}) {
  const pauseLabel = t(locale, paused ? "overlay.resume" : "overlay.pause");

  return (
    <div className="flex h-full items-center gap-2 px-3">
      <div className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--recording-red)_14%,transparent)]">
        <span
          className={`rounded-full bg-[var(--recording-red)] transition-[width,height,opacity] ${paused ? "size-1.5 opacity-45" : "size-2 opacity-100 shadow-[0_0_0_4px_color-mix(in_oklab,var(--recording-red)_10%,transparent)]"}`}
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {paused ? (
          <span className="h-9 content-center text-xs font-medium text-muted-foreground">
            {t(locale, "overlay.paused")}
          </span>
        ) : (
          <VoiceMeter level={level} locale={locale} />
        )}
        <span className="ml-auto text-[18px] font-medium tabular-nums tracking-tight text-foreground">
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={pauseLabel}
          title={`${pauseLabel} · ${shortcut}`}
          onClick={onTogglePause}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t(locale, "overlay.process")}
          title={`${t(locale, "overlay.process")} · ${processShortcut}`}
          onClick={onProcess}
        >
          <Send className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t(locale, "overlay.cancel")}
          title={`${t(locale, "overlay.cancel")} · ${cancelShortcut}`}
          onClick={onCancel}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
