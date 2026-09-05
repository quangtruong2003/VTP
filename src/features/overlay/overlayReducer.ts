import type { OverlayEvent, OverlayState, OverlayViewModel } from "@/lib/types";

export type OverlayReducerAction =
  | { type: "overlay_event"; event: OverlayEvent }
  | { type: "dismiss_start"; sessionId: number }
  | { type: "hidden"; sessionId: number };

export const initialOverlayModel: OverlayViewModel = {
  sessionId: 0,
  state: { phase: "idle" },
  lifecycle: "hidden",
  dismissedSessionId: 0,
  processingElapsedMs: 0,
  showLongProcessingHint: false,
  showCancel: false,
  autoDismissEligible: false,
};

export function reduceOverlayAction(
  current: OverlayViewModel,
  action: OverlayReducerAction,
): OverlayViewModel {
  if (action.type === "dismiss_start") {
    if (action.sessionId !== current.sessionId || current.lifecycle !== "visible") {
      return current;
    }
    return {
      ...current,
      lifecycle: "exiting",
      dismissedSessionId: Math.max(current.dismissedSessionId, action.sessionId),
      autoDismissEligible: false,
    };
  }

  if (action.type === "hidden") {
    if (action.sessionId !== current.sessionId || current.lifecycle !== "exiting") {
      return current;
    }
    return {
      ...current,
      lifecycle: "hidden",
      autoDismissEligible: false,
    };
  }

  const event = action.event;
  if (event.session_id < current.sessionId) return current;
  if (event.session_id <= current.dismissedSessionId && event.session_id <= current.sessionId) {
    return current;
  }

  const { session_id: sessionId, ...state } = event;
  const nextState = state as OverlayState;
  return {
    sessionId,
    state: nextState,
    lifecycle: nextState.phase === "idle" ? "hidden" : "visible",
    dismissedSessionId: current.dismissedSessionId,
    processingElapsedMs: 0,
    showLongProcessingHint: false,
    showCancel: false,
    autoDismissEligible:
      nextState.phase === "success" && nextState.pasted === true,
  };
}

export function reduceOverlayEvent(
  current: OverlayViewModel,
  event: OverlayEvent,
): OverlayViewModel {
  return reduceOverlayAction(current, { type: "overlay_event", event });
}
