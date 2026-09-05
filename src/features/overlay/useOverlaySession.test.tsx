import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onOverlayDismiss, onOverlayState, overlayApi } from "@/lib/overlay";
import type { OverlayEvent } from "@/lib/types";
import { INSERTED_DISMISS_MS, useOverlaySession } from "./useOverlaySession";

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
    });

    expect(overlayApi.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.model.lifecycle).toBe("exiting");
    expect(overlayApi.hide).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.completeExit();
    });
    expect(overlayApi.hide).toHaveBeenCalledTimes(1);
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
