import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { VoiceMeter } from "@/features/overlay/VoiceMeter";
import { t, type UiLocale } from "@/lib/i18n";
import { onMicLevel } from "@/lib/settings";

export function MicLevelIndicator({
  locale,
  compact = false,
  initialLevel = 0,
}: {
  locale: UiLocale;
  compact?: boolean;
  initialLevel?: number;
}) {
  const [level, setLevel] = useState(initialLevel);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onMicLevel(({ level: nextLevel }) => {
      if (!disposed) setLevel(nextLevel);
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {
        // The microphone controls remain usable without live meter events.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (compact) {
    return (
      <div className="min-w-0 flex-1">
        <div className="scale-[0.80] origin-left">
          <VoiceMeter level={level} locale={locale} />
        </div>
        <StatusBadge tone={level > 12 ? "success" : "neutral"}>
          {t(locale, level > 12 ? "settings.receivingAudio" : "settings.noAudioYet")}
        </StatusBadge>
      </div>
    );
  }

  return (
    <>
      <VoiceMeter level={level} locale={locale} />
      <div className="mt-1 text-xs text-muted-foreground">
        {t(locale, level > 12 ? "settings.receivingAudio" : "settings.noAudioYet")}
      </div>
    </>
  );
}
