import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  onSettingsSaved: vi.fn(),
  useOverlaySession: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  settingsApi: {
    get: mocks.settingsGet,
  },
  onSettingsSaved: mocks.onSettingsSaved,
}));

vi.mock("@/features/overlay/useOverlaySession", () => ({
  useOverlaySession: mocks.useOverlaySession,
}));

import { OverlayApp } from "./OverlayApp";
import type { OverlayState, OverlayViewModel } from "@/lib/types";

const model: OverlayViewModel = {
  sessionId: 1,
  state: { phase: "recording" as const, elapsed_ms: 0, level: 0 },
  lifecycle: "visible" as const,
  dismissedSessionId: 0,
  processingElapsedMs: 0,
  showLongProcessingHint: false,
  showCancel: false,
  autoDismissEligible: false,
};

function sessionValue(sessionId: number, state: OverlayState = model.state) {
  return {
    model: { ...model, sessionId, state },
    startRecording: vi.fn(),
    togglePause: vi.fn(),
    processRecording: vi.fn(),
    cancel: vi.fn(),
    reprocessAudio: vi.fn(),
    retryInsertion: vi.fn(),
    copyLastResult: vi.fn(),
    startNewRecording: vi.fn(),
    hide: vi.fn(),
    completeExit: vi.fn(),
    openSettings: vi.fn(),
    copyText: vi.fn(),
    insertResult: vi.fn(),
  };
}

function settings(
  shortcut: string,
  processShortcut: string,
  cancelShortcut: string,
  uiLocale: "vi" | "en",
) {
  return {
    shortcut,
    process_shortcut: processShortcut,
    cancel_shortcut: cancelShortcut,
    ui_locale: uiLocale,
  };
}

beforeEach(() => {
  mocks.settingsGet.mockReset();
  mocks.onSettingsSaved.mockReset();
  mocks.settingsGet.mockResolvedValue(
    settings("CmdOrCtrl+Shift+Space", "Enter", "Escape", "en"),
  );
  mocks.onSettingsSaved.mockResolvedValue(() => {});
  mocks.useOverlaySession.mockReturnValue(sessionValue(1));
});

describe("OverlayApp settings refresh", () => {
  it("loads settings once and applies a saved-settings event immediately", async () => {
    let onSaved!: (next: ReturnType<typeof settings>) => void;
    mocks.onSettingsSaved.mockImplementationOnce(async (callback: (next: ReturnType<typeof settings>) => void) => {
      onSaved = callback;
      return () => {};
    });

    render(<OverlayApp />);
    expect(await screen.findByRole("button", { name: "Pause" })).toHaveAttribute(
      "title",
      "Pause · CmdOrCtrl+Shift+Space",
    );

    await act(async () => {
      onSaved(settings("Ctrl+Alt+R", "Ctrl+Enter", "Alt+Escape", "vi"));
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: /tạm dừng/i })).toHaveAttribute(
      "title",
      expect.stringContaining("Ctrl+Alt+R"),
    );
    expect(mocks.settingsGet).toHaveBeenCalledTimes(1);
  });

  it("does not reload settings for every new recording session", async () => {
    const { rerender } = render(<OverlayApp />);
    await screen.findByRole("button", { name: "Pause" });

    mocks.useOverlaySession.mockReturnValue(sessionValue(2));

    await act(async () => {
      rerender(<OverlayApp />);
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute(
      "title",
      expect.stringContaining("CmdOrCtrl+Shift+Space"),
    );
    expect(mocks.settingsGet).toHaveBeenCalledTimes(1);
  });

  it("wires success recovery to retryInsertion", async () => {
    const session = sessionValue(1, {
      phase: "success",
      text: "hello",
      pasted: false,
      copied: true,
      output: "copied",
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(session.retryInsertion).toHaveBeenCalledTimes(1);
  });

  it("wires processing-error recovery to reprocessAudio", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "network", recoverable: true },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(session.reprocessAudio).toHaveBeenCalledTimes(1);
  });

  it("keeps insertion-error recovery pointed at retryInsertion", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "insertion_failed", recoverable: true, detail: "focus restore failed" },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(session.retryInsertion).toHaveBeenCalledTimes(1);
    expect(session.reprocessAudio).not.toHaveBeenCalled();
  });

  it("routes clipboard-error recovery to copyLastResult", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "clipboard_failed", recoverable: true, detail: "clipboard unavailable" },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    expect(session.copyLastResult).toHaveBeenCalledTimes(1);
    expect(session.retryInsertion).not.toHaveBeenCalled();
  });

  it("opens the relevant settings section for microphone errors", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "microphone_device", recoverable: true },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));

    expect(session.openSettings).toHaveBeenCalledWith("voice");
    expect(screen.queryByRole("button", { name: "New recording" })).not.toBeInTheDocument();
  });

  it("wires error recovery to a fresh recording", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "network", recoverable: true },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);
    fireEvent.click(await screen.findByRole("button", { name: "New recording" }));

    expect(session.startNewRecording).toHaveBeenCalledTimes(1);
  });

  it("does not offer a fresh recording when Gemini setup is missing", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "missing_api_key", recoverable: false },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);

    expect(screen.queryByRole("button", { name: "New recording" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });

  it("does not offer a fresh recording before a shortcut conflict is fixed", async () => {
    const session = sessionValue(1, {
      phase: "error",
      error: { code: "shortcut_conflict", recoverable: true },
    });
    mocks.useOverlaySession.mockReturnValue(session);

    render(<OverlayApp />);

    expect(screen.queryByRole("button", { name: "New recording" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });
});
