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
      output: "inserted",
    });
    expect(stale).toEqual(current);
  });

  it("accepts live updates within the current session", () => {
    const recording = reduceOverlayEvent(initialOverlayModel, {
      session_id: 9,
      phase: "recording",
      elapsed_ms: 250,
      level: 20,
    });
    const updated = reduceOverlayEvent(recording, {
      session_id: 9,
      phase: "recording",
      elapsed_ms: 500,
      level: 180,
    });

    expect(updated.state).toEqual({
      phase: "recording",
      elapsed_ms: 500,
      level: 180,
    });
  });

  it("auto dismisses only inserted success", () => {
    const inserted = reduceOverlayEvent(initialOverlayModel, {
      session_id: 1,
      phase: "success",
      text: "ok",
      pasted: true,
      copied: true,
      output: "inserted",
    });
    const copiedOnly = reduceOverlayEvent(initialOverlayModel, {
      session_id: 2,
      phase: "success",
      text: "ok",
      pasted: false,
      copied: true,
      output: "copied",
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
      output: "inserted",
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

  it("keeps a newer live event when an older snapshot arrives later", () => {
    const live = reduceOverlayEvent(initialOverlayModel, {
      session_id: 8,
      phase: "recording",
      elapsed_ms: 100,
      level: 20,
      health: "healthy",
      warning: null,
    });
    const snapshot = reduceOverlayEvent(live, {
      session_id: 7,
      phase: "opening",
      device_name: null,
    });
    expect(snapshot).toEqual(live);
  });
});
