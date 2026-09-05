import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { onOverlayDismiss, onOverlayState, overlayApi } from "@/lib/overlay";
import type { OverlayViewModel } from "@/lib/types";
import { initialOverlayModel, reduceOverlayAction } from "./overlayReducer";

export const PROCESSING_HINT_MS = 2_500;
export const PROCESSING_CANCEL_MS = 8_000;
export const INSERTED_DISMISS_MS = 750;

export function useOverlaySession() {
  const [baseModel, dispatch] = useReducer(reduceOverlayAction, initialOverlayModel);
  const [processingElapsedMs, setProcessingElapsedMs] = useState(0);
  const [pointerInteracting, setPointerInteracting] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(baseModel);
  modelRef.current = baseModel;

  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;
    let disposed = false;

    void onOverlayState((event) => dispatch({ type: "overlay_event", event })).then((cleanup) => {
      if (disposed) cleanup();
      else unlistenState = cleanup;
    });
    void onOverlayDismiss((event) => {
      dispatch({ type: "dismiss_start", sessionId: event.session_id });
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlistenDismiss = cleanup;
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
    const startedAt = performance.now();
    setProcessingElapsedMs(0);
    const update = () => setProcessingElapsedMs(Math.max(0, performance.now() - startedAt));
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
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
  }, [baseModel.autoDismissEligible, baseModel.lifecycle, baseModel.sessionId, phase]);

  const model = useMemo<OverlayViewModel>(
    () => ({
      ...baseModel,
      processingElapsedMs,
      showLongProcessingHint: isProcessing && processingElapsedMs >= PROCESSING_HINT_MS,
      showCancel: isProcessing && processingElapsedMs >= PROCESSING_CANCEL_MS,
    }),
    [baseModel, isProcessing, processingElapsedMs],
  );

  const startRecording = useCallback(() => overlayApi.startRecording(), []);
  const togglePause = useCallback(() => overlayApi.togglePause(), []);
  const processRecording = useCallback(() => overlayApi.processRecording(), []);
  const cancel = useCallback(() => {
    const sessionId = modelRef.current.sessionId;
    const cancellation = overlayApi.cancel();
    dispatch({ type: "dismiss_start", sessionId });
    return cancellation;
  }, []);
  const retry = useCallback(() => overlayApi.retry(), []);
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
  const openSettings = useCallback(() => overlayApi.openSettings(), []);
  const copyText = useCallback((text: string) => overlayApi.copyText(text), []);

  return {
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
    pointerInteracting,
    setPointerInteracting,
  };
}
