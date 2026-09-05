import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IdleState } from "@/app/OverlayApp";
import { RecordingState } from "./RecordingState";
import { ProcessingState } from "./ProcessingState";
import { SuccessState } from "./SuccessState";
import { ErrorState } from "./ErrorState";
import { OverlayShell } from "./OverlayShell";

const noop = () => {};

describe("premium overlay states", () => {
  it("never exposes the legacy manual-start card", () => {
    render(<IdleState locale="en" onStart={noop} />);
    expect(screen.queryByText("Ready to record")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("keeps recording actions available without persistent Enter/Esc hints", () => {
    render(
      <RecordingState
        level={120}
        elapsedMs={3200}
        shortcut="CmdOrCtrl+Shift+Space"
        processShortcut="Enter"
        cancelShortcut="Escape"
        paused={false}
        locale="vi"
        onTogglePause={noop}
        onProcess={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /tạm dừng/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /xử lý/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hủy/i })).toBeInTheDocument();
    expect(screen.queryByText("Enter")).not.toBeInTheDocument();
    expect(screen.queryByText("Esc")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^dừng$/i })).not.toBeInTheDocument();
  });

  it("shows calm processing copy and only exposes cancel after the threshold", () => {
    const { rerender } = render(
      <ProcessingState locale="en" elapsedMs={1000} showHint={false} showCancel={false} onCancel={noop} />,
    );
    expect(screen.getByText("Processing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    rerender(
      <ProcessingState locale="en" elapsedMs={9000} showHint showCancel onCancel={noop} />,
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("renders inserted success as a compact confirmation", () => {
    render(
      <SuccessState
        text="hello"
        pasted
        copied
        locale="en"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
      />,
    );
    expect(screen.getByText("Inserted")).toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry|copy/i })).not.toBeInTheDocument();
  });

  it("keeps copied-only success visible with recovery actions", () => {
    render(
      <SuccessState
        text="hello"
        pasted={false}
        copied
        locale="vi"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
      />,
    );
    expect(screen.getByText(/chưa thể chèn/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy|sao chép/i })).toBeInTheDocument();
  });

  it("renders typed errors with localized recovery", () => {
    render(
      <ErrorState
        error={{ code: "microphone_device", recoverable: true, detail: "device unavailable" }}
        locale="vi"
        onRetry={noop}
        onOpenSettings={noop}
        onHide={noop}
      />,
    );
    expect(screen.getByText(/không thể dùng micro/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /micro|cài đặt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /đóng|close/i })).toBeInTheDocument();
  });

  it("does not render a visible shell while lifecycle is hidden", () => {
    const { container } = render(
      <OverlayShell lifecycle="hidden" onExitComplete={noop}>
        <div>hidden content</div>
      </OverlayShell>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps one stable outer shell while inner state content changes", () => {
    const { rerender } = render(
      <OverlayShell lifecycle="visible" onExitComplete={noop}>
        <div>recording</div>
      </OverlayShell>,
    );
    const shell = screen.getByTestId("overlay-shell");

    rerender(
      <OverlayShell lifecycle="visible" onExitComplete={noop}>
        <div>processing</div>
      </OverlayShell>,
    );

    expect(screen.getByTestId("overlay-shell")).toBe(shell);
    expect(screen.getByText("processing")).toBeInTheDocument();
  });

  it("marks the same shell as exiting instead of swapping to a blank surface", () => {
    render(
      <OverlayShell lifecycle="exiting" onExitComplete={noop}>
        <div>current state</div>
      </OverlayShell>,
    );
    expect(screen.getByTestId("overlay-shell")).toHaveAttribute("data-lifecycle", "exiting");
    expect(screen.getByText("current state")).toBeInTheDocument();
  });

  it("completes exit even when the CSS animationend event never arrives", () => {
    vi.useFakeTimers();
    const onExitComplete = vi.fn();
    render(
      <OverlayShell lifecycle="exiting" onExitComplete={onExitComplete}>
        <div>current state</div>
      </OverlayShell>,
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(onExitComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
