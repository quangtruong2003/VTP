import { useEffect, useState } from "react";
import { resolveUiLocale, t, type UiLocale } from "@/lib/i18n";
import { onSettingsSaved, settingsApi } from "@/lib/settings";
import { ErrorState } from "@/features/overlay/ErrorState";
import { OverlayShell } from "@/features/overlay/OverlayShell";
import { ProcessingState } from "@/features/overlay/ProcessingState";
import { RecordingState } from "@/features/overlay/RecordingState";
import { SuccessState } from "@/features/overlay/SuccessState";
import { useOverlaySession } from "@/features/overlay/useOverlaySession";

const DEFAULT_SHORTCUT = "CmdOrCtrl+Shift+Space";
const DEFAULT_PROCESS_SHORTCUT = "";
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
    reprocessAudio,
    retryInsertion,
    copyLastResult,
    startNewRecording,
    hide,
    completeExit,
    openSettings,
    copyText,
    insertResult,
  } = useOverlaySession();
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [processShortcut, setProcessShortcut] = useState(DEFAULT_PROCESS_SHORTCUT);
  const [cancelShortcut, setCancelShortcut] = useState(DEFAULT_CANCEL_SHORTCUT);
  const [locale, setLocale] = useState<UiLocale>(() =>
    resolveUiLocale("system", typeof navigator === "undefined" ? "en" : navigator.language),
  );

  useEffect(() => {
    let active = true;
    const applySettings = (settings: Awaited<ReturnType<typeof settingsApi.get>>) => {
      if (!active) return;
      setShortcut(settings.shortcut || DEFAULT_SHORTCUT);
      setProcessShortcut(settings.process_shortcut);
      setCancelShortcut(settings.cancel_shortcut || DEFAULT_CANCEL_SHORTCUT);
      setLocale(resolveUiLocale(settings.ui_locale, navigator.language));
    };

    void settingsApi.get().then(applySettings).catch(() => {});
    const unlistenSaved = onSettingsSaved(applySettings).catch(() => () => {});

    return () => {
      active = false;
      void unlistenSaved.then((unlisten) => unlisten());
    };
  }, []);

  const state = model.state;
  let content;
  switch (state.phase) {
    case "idle":
      content = <IdleState locale={locale} onStart={() => void startRecording()} />;
      break;
    case "opening":
      content = (
        <div role="status" aria-live="polite" className="flex h-full items-center gap-2.5 px-3.5 text-xs text-zinc-100">
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-300" />
          {t(locale, "overlay.openingMicrophone")}
        </div>
      );
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
          health={state.health ?? "healthy"}
          warning={state.warning ?? null}
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
          health="healthy"
          warning={null}
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
          status={state.phase === "processing" ? state.status : "encoding"}
          model={state.phase === "processing" ? state.model : null}
          onCancel={() => void cancel()}
        />
      );
      break;
    case "success":
      content = (
        <SuccessState
          text={state.text}
          output={state.output}
          profile={state.profile}
          locale={locale}
          onCopy={(text) => void copyText(text)}
          onRetry={(text) => void retryInsertion(text)}
          onHide={() => void hide()}
          onInsert={(text) => void insertResult(text)}
        />
      );
      break;
    case "error":
      content = (
        <ErrorState
          error={state.error}
          locale={locale}
          onRetry={() => void (
            state.error.code === "insertion_failed"
              ? retryInsertion()
              : state.error.code === "clipboard_failed"
                ? copyLastResult()
              : reprocessAudio()
          )}
          onStartNewRecording={() => startNewRecording()}
          recoveryAction={state.error.code === "clipboard_failed" ? "copy" : "retry"}
          onOpenSettings={(section) => void openSettings(section)}
          onHide={() => void hide()}
        />
      );
      break;
    case "info":
      content = (
        <div role="status" aria-live="polite" className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
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
    >
      <div key={`${model.sessionId}:${visualPhase}`} className="overlay-state-content h-full w-full">
        {content}
      </div>
    </OverlayShell>
  );
}
