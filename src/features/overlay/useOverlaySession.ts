import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  frontendErrorFromRejection,
  onOverlayDismiss,
  onOverlayState,
  overlayApi,
} from "@/lib/overlay";
import type { OverlayViewModel } from "@/lib/types";
import { initialOverlayModel, reduceOverlayAction } from "./overlayReducer";

export const PROCESSING_HINT_MS = 2_500;
export const PROCESSING_CANCEL_MS = 8_000;
export const INSERTED_DISMISS_MS = 750;

type PendingCommand = "pause" | "process" | "cancel";

export function useOverlaySession() {
  const [baseModel, dispatch] = useReducer(reduceOverlayAction, initialOverlayModel);
  const [processingElapsedMs, setProcessingElapsedMs] = useReducer(
    (_current: number, next: number) => next,
    0,
  );
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandRefs = useRef<Partial<Record<PendingCommand, { sessionId: number; request: Promise<void> }>>>({});
  const recoveryRef = useRef<{ sessionId: number; request: Promise<void> } | null>(null);
  const processingSessionRef = useRef<number | null>(null);
  const cancelledSessionRef = useRef<number | null>(null);
  const latestLiveSessionRef = useRef<number | null>(null);
  const modelRef = useRef(baseModel);
  modelRef.current = baseModel;

  const reportCommandError = useCallback((sessionId: number, error: unknown) => {
    if (modelRef.current.sessionId !== sessionId) return;
    dispatch({
      type: "overlay_event",
      event: {
        session_id: Math.max(1, sessionId),
        phase: "error",
        error: frontendErrorFromRejection(error),
      },
    });
  }, []);

  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      const stateSubscription = onOverlayState((event) => {
        latestLiveSessionRef.current = event.session_id;
        dispatch({ type: "overlay_event", event });
      });
      const dismissSubscription = onOverlayDismiss((event) => {
        dispatch({ type: "dismiss_start", sessionId: event.session_id });
      });
      const [stateCleanup, dismissCleanup] = await Promise.all([
        stateSubscription,
        dismissSubscription,
      ]);
      if (disposed) {
        stateCleanup();
        dismissCleanup();
        return;
      }
      unlistenState = stateCleanup;
      unlistenDismiss = dismissCleanup;

      const snapshot = await overlayApi.getSnapshot();
      if (
        !disposed
        && snapshot
        && latestLiveSessionRef.current !== snapshot.session_id
      ) {
        dispatch({ type: "overlay_event", event: snapshot });
      }
    })().catch((error) => {
      if (disposed) return;
      dispatch({
        type: "overlay_event",
        event: {
          session_id: Math.max(1, modelRef.current.sessionId),
          phase: "error",
          error: frontendErrorFromRejection(error),
        },
      });
    });

    return () => {
      disposed = true;
      unlistenState?.();
      unlistenDismiss?.();
    };
  }, []);

  const phase = baseModel.state.phase;
  const isProcessing = phase === "uploading" || phase === "processing";
  const processingKey = `${baseModel.sessionId}:${isProcessing ? "processing" : phase}`;

  useEffect(() => {
    if (!isProcessing) {
      setProcessingElapsedMs(0);
      return;
    }

    setProcessingElapsedMs(0);
    const hintTimer = window.setTimeout(
      () => setProcessingElapsedMs(PROCESSING_HINT_MS),
      PROCESSING_HINT_MS,
    );
    const cancelTimer = window.setTimeout(
      () => setProcessingElapsedMs(PROCESSING_CANCEL_MS),
      PROCESSING_CANCEL_MS,
    );
    return () => {
      window.clearTimeout(hintTimer);
      window.clearTimeout(cancelTimer);
    };
  }, [processingKey, isProcessing]);

  useEffect(() => {
    if (!baseModel.autoDismissEligible || baseModel.lifecycle !== "visible") {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
      return;
    }

    if (dismissTimerRef.current) return;
    const sessionId = baseModel.sessionId;
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      dispatch({ type: "dismiss_start", sessionId });
    }, INSERTED_DISMISS_MS);

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [baseModel.autoDismissEligible, baseModel.lifecycle, baseModel.sessionId]);

  const model = useMemo<OverlayViewModel>(
    () => ({
      ...baseModel,
      processingElapsedMs,
      showLongProcessingHint:
        isProcessing && (processingElapsedMs >= PROCESSING_HINT_MS ||
          (baseModel.state.phase === "processing" && baseModel.state.status === "long_running")),
      showCancel:
        isProcessing && (processingElapsedMs >= PROCESSING_CANCEL_MS ||
          (baseModel.state.phase === "processing" && baseModel.state.status === "long_running")),
    }),
    [baseModel, isProcessing, processingElapsedMs],
  );

  const runOnce = useCallback((key: PendingCommand, command: () => Promise<void>) => {
    const sessionId = modelRef.current.sessionId;
    const pending = commandRefs.current[key];
    if (pending?.sessionId === sessionId) return pending.request;

    const request = command().catch((error) => {
      reportCommandError(sessionId, error);
    });
    commandRefs.current[key] = { sessionId, request };
    void request.then(
      () => {
        if (commandRefs.current[key]?.request === request) delete commandRefs.current[key];
      },
      () => {
        if (commandRefs.current[key]?.request === request) delete commandRefs.current[key];
      },
    );
    return request;
  }, [reportCommandError]);

  const startRecording = useCallback(() => {
    const sessionId = modelRef.current.sessionId;
    return Promise.resolve(overlayApi.startRecording()).catch((error) => {
      reportCommandError(sessionId, error);
    });
  }, [reportCommandError]);
  const togglePause = useCallback(
    () => runOnce("pause", overlayApi.togglePause),
    [runOnce],
  );
  const processRecording = useCallback(() => {
    const sessionId = modelRef.current.sessionId;
    if (processingSessionRef.current === sessionId || cancelledSessionRef.current === sessionId) {
      return Promise.resolve();
    }
    processingSessionRef.current = sessionId;
    return runOnce("process", overlayApi.processRecording);
  }, [runOnce]);
  const cancel = useCallback(() => {
    const sessionId = modelRef.current.sessionId;
    if (cancelledSessionRef.current === sessionId) return Promise.resolve();
    cancelledSessionRef.current = sessionId;
    const cancellation = runOnce("cancel", overlayApi.cancel);
    dispatch({ type: "dismiss_start", sessionId });
    return cancellation;
  }, [runOnce]);
  const runRecoveryOnce = useCallback((command: () => Promise<void>) => {
    const sessionId = modelRef.current.sessionId;
    if (recoveryRef.current?.sessionId === sessionId) {
      return recoveryRef.current.request;
    }

    const request = command().catch((error) => {
      reportCommandError(sessionId, error);
    });
    recoveryRef.current = { sessionId, request };
    void request.then(
      () => {
        if (recoveryRef.current?.request === request) recoveryRef.current = null;
      },
      () => {
        if (recoveryRef.current?.request === request) recoveryRef.current = null;
      },
    );
    return request;
  }, [reportCommandError]);
  const reprocessAudio = useCallback(
    () => runRecoveryOnce(overlayApi.reprocessAudio),
    [runRecoveryOnce],
  );
  const retryInsertion = useCallback(
    (text?: string) => runRecoveryOnce(() => overlayApi.retryInsertion(text)),
    [runRecoveryOnce],
  );
  const copyLastResult = useCallback(
    () => runRecoveryOnce(overlayApi.copyLastResult),
    [runRecoveryOnce],
  );
  const startNewRecording = useCallback(
    () => runRecoveryOnce(overlayApi.startNewRecording),
    [runRecoveryOnce],
  );
  const hide = useCallback(() => {
    dispatch({ type: "dismiss_start", sessionId: modelRef.current.sessionId });
  }, []);
  const completeExit = useCallback(async () => {
    const current = modelRef.current;
    if (current.lifecycle !== "exiting") return;
    const sessionId = current.sessionId;
    try {
      await overlayApi.hide();
    } catch {
      // Best-effort native hide. UI lifecycle must still transition to hidden.
    } finally {
      if (modelRef.current.sessionId === sessionId && modelRef.current.lifecycle === "exiting") {
        dispatch({ type: "hidden", sessionId });
      }
    }
  }, []);
  const openSettings = useCallback((section?: string) => {
    const sessionId = modelRef.current.sessionId;
    return Promise.resolve(overlayApi.openSettings(section)).catch((error) => {
      reportCommandError(sessionId, error);
    });
  }, [reportCommandError]);
  const copyText = useCallback((text: string) => {
    const sessionId = modelRef.current.sessionId;
    return overlayApi.copyText(text).catch((error) => {
      reportCommandError(sessionId, error);
    });
  }, [reportCommandError]);
  const insertResult = useCallback(
    (text: string) => runRecoveryOnce(() => overlayApi.insertResult(text)),
    [runRecoveryOnce],
  );

  return {
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
  };
}
