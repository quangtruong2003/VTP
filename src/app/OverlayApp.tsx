import { useEffect, useState } from "react";
import { resolveUiLocale, t, type UiLocale } from "@/lib/i18n";
import { settingsApi } from "@/lib/settings";
import type { FrontendError } from "@/lib/types";
import { ErrorState } from "@/features/overlay/ErrorState";
import { OverlayShell } from "@/features/overlay/OverlayShell";
import { ProcessingState } from "@/features/overlay/ProcessingState";
import { RecordingState } from "@/features/overlay/RecordingState";
import { SuccessState } from "@/features/overlay/SuccessState";
import { useOverlaySession } from "@/features/overlay/useOverlaySession";

const DEFAULT_SHORTCUT = "CmdOrCtrl+Shift+Space";
const DEFAULT_PROCESS_SHORTCUT = "Enter";
const DEFAULT_CANCEL_SHORTCUT = "Escape";

export function IdleState(_props: { locale: UiLocale; onStart: () => void }) {
  return null;
}

export function OverlayApp() {
  const {
    model,
    startRecording,
    togglePause,
    processRecording,
    cancel,
    retry,
    hide,
    completeExit,
    openSettings,
    copyText,
    setPointerInteracting,
  } = useOverlaySession();
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [processShortcut, setProcessShortcut] = useState(DEFAULT_PROCESS_SHORTCUT);
  const [cancelShortcut, setCancelShortcut] = useState(DEFAULT_CANCEL_SHORTCUT);
  const [locale, setLocale] = useState<UiLocale>(() =>
    resolveUiLocale("system", typeof navigator === "undefined" ? "en" : navigator.language),
  );

  useEffect(() => {
    void settingsApi.get().then((settings) => {
      setShortcut(settings.shortcut || DEFAULT_SHORTCUT);
      setProcessShortcut(settings.process_shortcut || DEFAULT_PROCESS_SHORTCUT);
      setCancelShortcut(settings.cancel_shortcut || DEFAULT_CANCEL_SHORTCUT);
      setLocale(resolveUiLocale(settings.ui_locale, navigator.language));
    }).catch(() => {});
  }, [model.sessionId]);

  const state = model.state;
  let content;
  switch (state.phase) {
    case "idle":
      content = <IdleState locale={locale} onStart={() => void startRecording()} />;
      break;
    case "recording":
      content = (
        <RecordingState
          level={state.level}
          elapsedMs={state.elapsed_ms}
          shortcut={shortcut}
          processShortcut={processShortcut}
          cancelShortcut={cancelShortcut}
          paused={false}
          locale={locale}
          onTogglePause={() => void togglePause()}
          onProcess={() => void processRecording()}
          onCancel={() => void cancel()}
        />
      );
      break;
    case "paused":
      content = (
        <RecordingState
          level={0}
          elapsedMs={state.elapsed_ms}
          shortcut={shortcut}
          processShortcut={processShortcut}
          cancelShortcut={cancelShortcut}
          paused
          locale={locale}
          onTogglePause={() => void togglePause()}
          onProcess={() => void processRecording()}
          onCancel={() => void cancel()}
        />
      );
      break;
    case "uploading":
    case "processing":
      content = (
        <ProcessingState
          locale={locale}
          elapsedMs={model.processingElapsedMs}
          showHint={model.showLongProcessingHint}
          showCancel={model.showCancel}
          onCancel={() => void cancel()}
        />
      );
      break;
    case "success":
      if (!state.pasted && !state.copied) {
        const error: FrontendError = { code: "insertion_failed", recoverable: true };
        content = (
          <ErrorState
            error={error}
            locale={locale}
            onRetry={() => void retry()}
            onOpenSettings={() => void openSettings()}
            onHide={() => void hide()}
          />
        );
      } else {
        content = (
          <SuccessState
            text={state.text}
            pasted={state.pasted}
            copied={state.copied}
            locale={locale}
            onCopy={() => void copyText(state.text)}
            onRetry={() => void retry()}
            onHide={() => void hide()}
          />
        );
      }
      break;
    case "error":
      content = (
        <ErrorState
          error={state.error}
          locale={locale}
          onRetry={() => void retry()}
          onOpenSettings={() => void openSettings()}
          onHide={() => void hide()}
        />
      );
      break;
    case "info":
      content = (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {t(locale, "overlay.busy")}
        </div>
      );
      break;
  }

  const visualPhase = state.phase === "uploading" || state.phase === "processing"
    ? "processing"
    : state.phase;

  return (
    <OverlayShell
      lifecycle={model.lifecycle}
      onExitComplete={() => void completeExit()}
      onPointerEnter={() => setPointerInteracting(true)}
      onPointerLeave={() => setPointerInteracting(false)}
    >
      <div key={`${model.sessionId}:${visualPhase}`} className="overlay-state-content h-full w-full">
        {content}
      </div>
    </OverlayShell>
  );
}
