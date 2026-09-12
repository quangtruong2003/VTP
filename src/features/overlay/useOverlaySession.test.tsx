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
  frontendErrorFromRejection: (error: unknown) => error,
  onOverlayState: vi.fn(),
  onOverlayDismiss: vi.fn(),
  overlayApi: {
    getSnapshot: vi.fn(),
    toggle: vi.fn(),
    startRecording: vi.fn(),
    togglePause: vi.fn(),
    processRecording: vi.fn(),
    cancel: vi.fn(),
    reprocessAudio: vi.fn(),
    retryInsertion: vi.fn(),
    copyLastResult: vi.fn(),
    startNewRecording: vi.fn(),
    hide: vi.fn(),
    openSettings: vi.fn(),
    copyText: vi.fn(),
    insertResult: vi.fn(),
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
    vi.mocked(overlayApi.getSnapshot).mockResolvedValue(null);
  });

  it("subscribes before reading the current session snapshot", async () => {
    const order: string[] = [];
    vi.mocked(onOverlayState).mockImplementation(async () => {
      order.push("subscribe");
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.getSnapshot).mockImplementation(async () => {
      order.push("snapshot");
      return { session_id: 4, phase: "opening", device_name: null };
    });

    const { result } = renderHook(() => useOverlaySession());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(order).toEqual(["subscribe", "snapshot"]);
    expect(result.current.model.state.phase).toBe("opening");
  });

  it("does not let a same-session stale snapshot overwrite a newer live event", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    let resolveSnapshot: ((event: OverlayEvent | null) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.getSnapshot).mockImplementation(
      () => new Promise((resolve) => { resolveSnapshot = resolve; }),
    );

    const { result } = renderHook(() => useOverlaySession());
    await act(async () => { await Promise.resolve(); });
    act(() => {
      listener?.({ session_id: 21, phase: "recording", elapsed_ms: 100, level: 5 });
    });
    await act(async () => {
      resolveSnapshot?.({ session_id: 21, phase: "opening", device_name: null });
      await Promise.resolve();
    });

    expect(result.current.model.state.phase).toBe("recording");
  });

  it("does not let a lower-session snapshot overwrite a newer live event", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    let resolveSnapshot: ((event: OverlayEvent | null) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.getSnapshot).mockImplementation(
      () => new Promise((resolve) => { resolveSnapshot = resolve; }),
    );

    const { result } = renderHook(() => useOverlaySession());
    await act(async () => { await Promise.resolve(); });
    act(() => {
      listener?.({ session_id: 22, phase: "recording", elapsed_ms: 100, level: 5 });
    });
    await act(async () => {
      resolveSnapshot?.({ session_id: 21, phase: "opening", device_name: null });
      await Promise.resolve();
    });

    expect(result.current.model.sessionId).toBe(22);
    expect(result.current.model.state.phase).toBe("recording");
  });

  it("surfaces copy failures as typed overlay errors", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.copyText).mockRejectedValue({
      code: "clipboard_failed",
      recoverable: true,
      detail: "clipboard unavailable",
    });

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({
        session_id: 23,
        phase: "success",
        text: "hello",
        pasted: false,
        copied: false,
        output: "preview",
      });
    });

    await act(async () => {
      await result.current.copyText("hello");
    });

    expect(result.current.model.state).toMatchObject({
      phase: "error",
      error: { code: "clipboard_failed" },
    });
  });

  it("surfaces a rejected start command instead of leaving an unhandled promise", async () => {
    vi.mocked(onOverlayState).mockResolvedValue(() => {});
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.startRecording).mockRejectedValue({
      code: "microphone_device",
      recoverable: true,
      detail: "device unavailable",
    });

    const { result } = renderHook(() => useOverlaySession());
    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.model.state).toMatchObject({
      phase: "error",
      error: { code: "microphone_device" },
    });
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
        output: "inserted",
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

  it("deduplicates rapid retry and insert requests", () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.reprocessAudio).mockImplementation(() => new Promise<void>(() => {}));
    vi.mocked(overlayApi.retryInsertion).mockImplementation(() => new Promise<void>(() => {}));
    vi.mocked(overlayApi.startNewRecording).mockImplementation(() => new Promise<void>(() => {}));
    vi.mocked(overlayApi.insertResult).mockImplementation(() => new Promise<void>(() => {}));

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({ session_id: 31, phase: "success", text: "hello", pasted: false, copied: true, output: "copied" });
    });
    act(() => {
      void result.current.reprocessAudio();
      void result.current.retryInsertion();
      void result.current.startNewRecording();
      void result.current.insertResult("hello");
      void result.current.insertResult("hello");
    });

    expect(overlayApi.reprocessAudio).toHaveBeenCalledTimes(1);
    expect(overlayApi.retryInsertion).not.toHaveBeenCalled();
    expect(overlayApi.startNewRecording).not.toHaveBeenCalled();
    expect(overlayApi.insertResult).not.toHaveBeenCalled();
  });

  it("passes the current preview text to insertion retry", () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.retryInsertion).mockResolvedValue(undefined);

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({ session_id: 33, phase: "success", text: "original", pasted: false, copied: false, output: "preview" });
      void result.current.retryInsertion("edited preview");
    });

    expect(overlayApi.retryInsertion).toHaveBeenCalledWith("edited preview");
  });

  it("surfaces typed recovery command rejection with its reason", async () => {
    let listener: ((event: OverlayEvent) => void) | undefined;
    vi.mocked(onOverlayState).mockImplementation(async (cb) => {
      listener = cb;
      return () => {};
    });
    vi.mocked(onOverlayDismiss).mockResolvedValue(() => {});
    vi.mocked(overlayApi.retryInsertion).mockRejectedValue({
      code: "insertion_failed",
      recoverable: true,
      detail: "focus restore failed",
    });

    const { result } = renderHook(() => useOverlaySession());
    act(() => {
      listener?.({ session_id: 34, phase: "success", text: "hello", pasted: false, copied: false, output: "preview" });
    });
    await act(async () => {
      await result.current.retryInsertion("hello");
    });

    expect(result.current.model.state).toEqual({
      phase: "error",
      error: {
        code: "insertion_failed",
        recoverable: true,
        detail: "focus restore failed",
      },
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
        output: "inserted",
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
        output: "inserted",
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
