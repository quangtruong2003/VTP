import { useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, CornerDownLeft, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { promptProfileLabel, t, type UiLocale } from "@/lib/i18n";
import type { OverlayProfile, OutputOutcome } from "@/lib/types";

export function SuccessState({
  text,
  output,
  profile,
  locale,
  onCopy,
  onRetry,
  onHide,
  onInsert,
}: {
  text: string;
  output: OutputOutcome;
  profile?: OverlayProfile | null;
  locale: UiLocale;
  onCopy: (text: string) => void;
  onRetry: (text: string) => void;
  onHide: () => void;
  onInsert?: (text: string) => void;
}) {
  const [draft, setDraft] = useState(text);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const visibleProfile = profile?.id === "natural" ? null : profile;
  const profileBadge = visibleProfile ? (
    <span
      data-testid="overlay-profile-badge"
      data-profile-id={visibleProfile.id}
      className="rounded-full border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
    >
      {promptProfileLabel(locale, visibleProfile.id, visibleProfile.name)}
    </span>
  ) : null;
  const previewOnly = output === "preview";

  if (output === "inserted") {
    return (
      <div className="flex h-full items-center gap-2.5 px-3.5 select-none" role="status" aria-live="polite">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0 text-xs font-medium leading-none text-zinc-100">
          <div>{t(locale, "overlay.inserted")}</div>
          {profileBadge}
        </div>
      </div>
    );
  }

  const insert = () => {
    const value = draft.trim();
    if (value) onInsert?.(value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insert();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onHide();
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3 select-none">
      <div role="status" aria-live="polite">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
          <span>{t(locale, previewOnly ? "overlay.resultPreview" : "overlay.notInserted")}</span>
          {profileBadge}
        </div>
        {output === "copied" ? <div className="mt-0.5 text-[10px] text-zinc-400">{t(locale, "overlay.copied")}</div> : null}
      </div>
      <textarea
        ref={previewRef}
        autoFocus
        aria-label={t(locale, "overlay.resultPreview")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-12 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs leading-[16px] text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
      />
      <div className="mt-auto flex items-center justify-end gap-1">
        {onInsert ? (
          <Button size="sm" variant="default" className="h-7 px-2.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-zinc-200" onClick={insert} aria-label={t(locale, "overlay.insert")}>
            <CornerDownLeft className="size-3.5" /> {t(locale, "overlay.insert")}
          </Button>
        ) : null}
        <Button size="sm" variant="default" className="h-7 px-2.5 text-xs bg-zinc-100 text-zinc-950 hover:bg-zinc-200" onClick={() => onCopy(draft)} aria-label={t(locale, "overlay.copy")}>
          <Copy className="size-3.5" /> {t(locale, "overlay.copy")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={() => onRetry(draft)} aria-label={t(locale, "overlay.retry")}>
          <RefreshCw className="size-3.5" /> {t(locale, "overlay.retry")}
        </Button>
        <Button size="icon" variant="ghost" className="size-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={onHide} aria-label={t(locale, "overlay.close")}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
