import { describe, expect, it } from "vitest";
import { initialOverlayModel, reduceOverlayAction, reduceOverlayEvent } from "./overlayReducer";

describe("overlay reducer", () => {
  it("ignores an older session event", () => {
    const current = reduceOverlayEvent(initialOverlayModel, {
      session_id: 9,
      phase: "recording",
      elapsed_ms: 250,
      level: 80,
    });
    const stale = reduceOverlayEvent(current, {
      session_id: 8,
      phase: "success",
      text: "old",
      pasted: true,
      copied: true,
    });
    expect(stale).toEqual(current);
  });

  it("auto dismisses only inserted success", () => {
    const inserted = reduceOverlayEvent(initialOverlayModel, {
      session_id: 1,
      phase: "success",
      text: "ok",
      pasted: true,
      copied: true,
    });
    const copiedOnly = reduceOverlayEvent(initialOverlayModel, {
      session_id: 2,
      phase: "success",
      text: "ok",
      pasted: false,
      copied: true,
    });
    expect(inserted.autoDismissEligible).toBe(true);
    expect(copiedOnly.autoDismissEligible).toBe(false);
  });

  it("marks idle as hidden instead of a visible blank shell", () => {
    const idle = reduceOverlayEvent(initialOverlayModel, {
      session_id: 1,
      phase: "idle",
    });
    expect(idle.lifecycle).toBe("hidden");
  });

  it("ignores same-session events after dismiss starts", () => {
    const recording = reduceOverlayEvent(initialOverlayModel, {
      session_id: 9,
      phase: "recording",
      elapsed_ms: 250,
      level: 80,
    });
    const exiting = reduceOverlayAction(recording, {
      type: "dismiss_start",
      sessionId: 9,
    });
    const lateSuccess = reduceOverlayEvent(exiting, {
      session_id: 9,
      phase: "success",
      text: "late",
      pasted: true,
      copied: true,
    });
    expect(exiting.lifecycle).toBe("exiting");
    expect(lateSuccess).toEqual(exiting);
  });

  it("allows a newer session to replace an exiting session", () => {
    const recording = reduceOverlayEvent(initialOverlayModel, {
      session_id: 9,
      phase: "recording",
      elapsed_ms: 250,
      level: 80,
    });
    const exiting = reduceOverlayAction(recording, {
      type: "dismiss_start",
      sessionId: 9,
    });
    const next = reduceOverlayEvent(exiting, {
      session_id: 10,
      phase: "recording",
      elapsed_ms: 0,
      level: 0,
    });
    expect(next.sessionId).toBe(10);
    expect(next.lifecycle).toBe("visible");
  });
});
