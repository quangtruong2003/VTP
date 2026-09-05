import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { meterRender } = vi.hoisted(() => ({
  meterRender: vi.fn(() => <div role="meter" />),
}));

vi.mock("./VoiceMeter", async () => {
  const React = await import("react");
  return {
    VoiceMeter: React.memo(meterRender),
  };
});

import { RecordingState } from "./RecordingState";

const noop = () => {};

function recordingState(elapsedMs: number, level = 80) {
  return (
    <RecordingState
      level={level}
      elapsedMs={elapsedMs}
      shortcut="CmdOrCtrl+Shift+Space"
      processShortcut="Enter"
      cancelShortcut="Escape"
      paused={false}
      locale="en"
      onTogglePause={noop}
      onProcess={noop}
      onCancel={noop}
    />
  );
}

describe("RecordingState render boundaries", () => {
  beforeEach(() => {
    meterRender.mockClear();
  });

  it("does not rerender the audio meter for timer-only updates", () => {
    const { rerender } = render(recordingState(100, 96));
    expect(meterRender).toHaveBeenCalledTimes(1);

    rerender(recordingState(900, 96));

    expect(meterRender).toHaveBeenCalledTimes(1);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("keeps the timer text stable for audio-level-only updates within one second", () => {
    const { rerender } = render(recordingState(100, 40));

    rerender(recordingState(900, 180));

    expect(screen.getByText("00:00")).toBeInTheDocument();
  });
});
