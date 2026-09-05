import { memo } from "react";
import { Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type UiLocale } from "@/lib/i18n";
import { VoiceMeter } from "./VoiceMeter";

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const RecordingTimer = memo(function RecordingTimer({ seconds }: { seconds: number }) {
  return (
    <span className="ml-auto text-xs font-mono font-medium tabular-nums tracking-tight text-zinc-100">
      {formatElapsed(seconds)}
    </span>
  );
});

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
    <div className="flex h-full items-center gap-2 px-3 select-none">
      <button
        type="button"
        className={`group relative flex size-7 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 ${
          paused
            ? "border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            : "border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 shadow-[0_0_10px_rgba(239,68,68,0.25)]"
        }`}
        aria-label={pauseLabel}
        title={`${pauseLabel} · ${shortcut}`}
        onClick={onTogglePause}
      >
        {paused ? (
          <Play className="size-3 text-zinc-200 ml-0.5" />
        ) : (
          <span className="size-2.5 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.2)] transition-transform group-hover:scale-110" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {paused ? (
          <span className="text-xs font-medium text-zinc-400">
            {t(locale, "overlay.paused")}
          </span>
        ) : (
          <VoiceMeter level={level} locale={locale} />
        )}
        <RecordingTimer seconds={Math.floor(elapsedMs / 1000)} />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="size-7 rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200 shadow-sm transition-all active:scale-90"
          aria-label={t(locale, "overlay.process")}
          title={`${t(locale, "overlay.process")} · ${processShortcut}`}
          onClick={onProcess}
        >
          <Send className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-all active:scale-90"
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
