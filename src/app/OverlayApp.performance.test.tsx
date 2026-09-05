import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  useOverlaySession: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  settingsApi: {
    get: mocks.settingsGet,
  },
}));

vi.mock("@/features/overlay/useOverlaySession", () => ({
  useOverlaySession: mocks.useOverlaySession,
}));

import { OverlayApp } from "./OverlayApp";

const model = {
  sessionId: 1,
  state: { phase: "recording" as const, elapsed_ms: 0, level: 0 },
  lifecycle: "visible" as const,
  dismissedSessionId: 0,
  processingElapsedMs: 0,
  showLongProcessingHint: false,
  showCancel: false,
  autoDismissEligible: false,
};

function sessionValue(sessionId: number) {
  return {
    model: { ...model, sessionId },
    startRecording: vi.fn(),
    togglePause: vi.fn(),
    processRecording: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    hide: vi.fn(),
    completeExit: vi.fn(),
    openSettings: vi.fn(),
    copyText: vi.fn(),
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
  mocks.settingsGet.mockResolvedValue(
    settings("CmdOrCtrl+Shift+Space", "Enter", "Escape", "en"),
  );
  mocks.useOverlaySession.mockReturnValue(sessionValue(1));
});

describe("OverlayApp settings refresh", () => {
  it("reloads shortcut labels and locale when a new recording session begins", async () => {
    const { rerender } = render(<OverlayApp />);
    expect(await screen.findByRole("button", { name: "Pause" })).toHaveAttribute(
      "title",
      "Pause · CmdOrCtrl+Shift+Space",
    );

    mocks.settingsGet.mockResolvedValue(
      settings("Ctrl+Alt+R", "Ctrl+Enter", "Alt+Escape", "vi"),
    );
    mocks.useOverlaySession.mockReturnValue(sessionValue(2));

    await act(async () => {
      rerender(<OverlayApp />);
      await Promise.resolve();
    });

    expect(await screen.findByRole("button", { name: /tạm dừng/i })).toHaveAttribute(
      "title",
      expect.stringContaining("Ctrl+Alt+R"),
    );
    expect(mocks.settingsGet).toHaveBeenCalledTimes(2);
  });

  it("ignores an older settings response after a newer session has loaded", async () => {
    let resolveOld!: (value: ReturnType<typeof settings>) => void;
    let resolveNew!: (value: ReturnType<typeof settings>) => void;
    mocks.settingsGet
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOld = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveNew = resolve;
      }));

    const { rerender } = render(<OverlayApp />);
    mocks.useOverlaySession.mockReturnValue(sessionValue(2));
    rerender(<OverlayApp />);

    await act(async () => {
      resolveNew(settings("Ctrl+Alt+R", "Ctrl+Enter", "Alt+Escape", "vi"));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /tạm dừng/i })).toHaveAttribute(
      "title",
      expect.stringContaining("Ctrl+Alt+R"),
    );

    await act(async () => {
      resolveOld(settings("Old+Shortcut", "Old+Enter", "Old+Escape", "en"));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /tạm dừng/i })).toHaveAttribute(
      "title",
      expect.stringContaining("Ctrl+Alt+R"),
    );
  });
});
