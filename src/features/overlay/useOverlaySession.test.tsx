import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onOverlayDismiss, onOverlayState, overlayApi } from "@/lib/overlay";
import type { OverlayEvent } from "@/lib/types";
import {
  INSERTED_DISMISS_MS,
  PROCESSING_CANCEL_MS,
  PROCESSING_HINT_MS,
  useOverlaySession,
} from "./useOverlaySession";

vi.mock("@/lib/overlay", () => ({
  onOverlayState: vi.fn(),
  onOverlayDismiss: vi.fn(),
  overlayApi: {
    toggle: vi.fn(),
    startRecording: vi.fn(),
    togglePause: vi.fn(),
    processRecording: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    hide: vi.fn(),
    openSettings: vi.fn(),
    copyText: vi.fn(),
  },
}));

describe("useOverlaySession dismissal lifecycle", () => {
  it("keeps the success confirmation brief", () => {
    expect(INSERTED_DISMISS_MS).toBeLessThanOrEqual(800);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(overlayApi.cancel).mockResolvedValue(undefined);
    vi.mocked(overlayApi.hide).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts inserted-success exit before hiding the native window", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});

    const { result } = renderHook(() => useOverlaySession());

    act(() => {
      listener?.({
        session_id: 42,
        phase: "success",
        text: "hello",
        pasted: true,
        copied: true,
      });
    });
    act(() => {
      vi.advanceTimersByTime(INSERTED_DISMISS_MS + 1);
    });

    expect(result.current.model.lifecycle).toBe("exiting");
    expect(overlayApi.hide).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.completeExit();
    });

    expect(overlayApi.hide).toHaveBeenCalledTimes(1);
    expect(result.current.model.lifecycle).toBe("hidden");
  });

  it("marks cancellation immediately and defers native hide until exit completes", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({
        session_id: 7,
        phase: "recording",
        elapsed_ms: 200,
        level: 50,
      });
    });

    act(() => {
      void result.current.cancel();
      void result.current.cancel();
    });

    expect(overlayApi.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.model.lifecycle).toBe("exiting");
    expect(overlayApi.hide).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.completeExit();
    });
    expect(overlayApi.hide).toHaveBeenCalledTimes(1);
  });

  it("deduplicates rapid pause requests", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    let resolvePause: (() => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.togglePause).mockImplementation(
      () => new Promise<void>((resolve) => {
        resolvePause = resolve;
      }),
    );

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({
        session_id: 8,
        phase: "recording",
        elapsed_ms: 200,
        level: 50,
      });
    });

    let firstPause!: Promise<void>;
    let secondPause!: Promise<void>;
    act(() => {
      firstPause = result.current.togglePause();
      secondPause = result.current.togglePause();
    });

    expect(firstPause).toBe(secondPause);
    expect(overlayApi.togglePause).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePause?.();
      await firstPause;
    });
  });

  it("allows cancel to supersede processing while deduplicating repeated cancel", () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.processRecording).mockResolvedValue(undefined);
    vi.mocked(overlayApi.cancel).mockResolvedValue(undefined);

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({
        session_id: 10,
        phase: "recording",
        elapsed_ms: 200,
        level: 50,
      });
      void result.current.processRecording();
      void result.current.cancel();
      void result.current.cancel();
    });

    expect(overlayApi.processRecording).toHaveBeenCalledTimes(1);
    expect(overlayApi.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not let an older session command block a newer session", () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.processRecording).mockImplementation(() => new Promise<void>(() => {}));

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({
        session_id: 12,
        phase: "recording",
        elapsed_ms: 200,
        level: 50,
      });
    });
    act(() => {
      void result.current.processRecording();
      listener?.({
        session_id: 13,
        phase: "recording",
        elapsed_ms: 0,
        level: 0,
      });
    });
    act(() => {
      void result.current.processRecording();
    });

    expect(overlayApi.processRecording).toHaveBeenCalledTimes(2);
  });
  it("updates processing UI only at the hint and cancel thresholds", () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({ session_id: 9, phase: "processing" });
    });

    expect(result.current.model.processingElapsedMs).toBe(0);
    act(() => {
      vi.advanceTimersByTime(PROCESSING_HINT_MS - 1);
    });
    expect(result.current.model.processingElapsedMs).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.model.showLongProcessingHint).toBe(true);
    expect(result.current.model.showCancel).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PROCESSING_CANCEL_MS - PROCESSING_HINT_MS);
    });
    expect(result.current.model.processingElapsedMs).toBe(PROCESSING_CANCEL_MS);
    expect(result.current.model.showCancel).toBe(true);
  });

  it("honors backend dismiss requests from the global cancel shortcut", () => {
    let stateListener: ((event: OverlayEvent) => void) | undefined;
    let dismissListener: ((event: { session_id: number }) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      stateListener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockImplementation(async (cb) => {
      dismissListener = cb;
      return () => {};
    });

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      stateListener?.({
        session_id: 11,
        phase: "processing",
      });
      dismissListener?.({ session_id: 11 });
    });

    expect(result.current.model.lifecycle).toBe("exiting");
    expect(overlayApi.hide).not.toHaveBeenCalled();
  });

  it("does not hide a newer session when an older exit completion arrives", async () => {
    let stateListener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      stateListener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      stateListener?.({
        session_id: 20,
        phase: "success",
        text: "done",
        pasted: true,
        copied: true,
      });
    });
    act(() => {
      vi.advanceTimersByTime(INSERTED_DISMISS_MS + 1);
    });
    expect(result.current.model.lifecycle).toBe("exiting");

    act(() => {
      stateListener?.({
        session_id: 21,
        phase: "recording",
        elapsed_ms: 0,
        level: 0,
      });
    });
    expect(result.current.model.lifecycle).toBe("visible");

    await act(async () => {
      await result.current.completeExit();
    });

    expect(overlayApi.hide).not.toHaveBeenCalled();
    expect(result.current.model.sessionId).toBe(21);
  });

  it("transitions lifecycle to hidden even when native hide rejects", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.hide).mockRejectedValue(new Error("native hide failed"));

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({
        session_id: 30,
        phase: "success",
        text: "hello",
        pasted: true,
        copied: true,
      });
    });
    act(() => {
      vi.advanceTimersByTime(INSERTED_DISMISS_MS + 1);
    });
    expect(result.current.model.lifecycle).toBe("exiting");

    await act(async () => {
      await result.current.completeExit();
    });

    expect(overlayApi.hide).toHaveBeenCalledTimes(1);
    expect(result.current.model.lifecycle).toBe("hidden");
  });
});
