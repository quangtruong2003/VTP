import { act, fireEvent, render, screen } from "@testing-library/react";
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
        health="healthy"
        warning={null}
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

  it("announces a default microphone fallback without hiding the audio meter", () => {
    render(
      <RecordingState
        level={0}
        elapsedMs={500}
        shortcut="CmdOrCtrl+Shift+Space"
        processShortcut="Enter"
        cancelShortcut="Escape"
        paused={false}
        health="warning"
        warning="default_microphone"
        locale="en"
        onTogglePause={noop}
        onProcess={noop}
        onCancel={noop}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/default microphone/i);
    expect(status).toHaveClass("sr-only");
    expect(screen.getByRole("meter")).toBeInTheDocument();
  });

  it("keeps microphone health announcements outside the pause control", () => {
    render(
      <RecordingState
        level={0}
        elapsedMs={500}
        shortcut="CmdOrCtrl+Shift+Space"
        processShortcut="Enter"
        cancelShortcut="Escape"
        paused={false}
        health="silent"
        locale="en"
        onTogglePause={noop}
        onProcess={noop}
        onCancel={noop}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/no microphone input/i);
    expect(status.closest("button")).toBeNull();
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

  it("renders fallback and long-running states without fake progress", () => {
    const { rerender } = render(
      <ProcessingState
        locale="en"
        elapsedMs={3000}
        showHint
        showCancel={false}
        status="fallback"
        model="gemini-2.5-pro"
        onCancel={noop}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/fallback model/i);
    expect(screen.getByText("Model: gemini-2.5-pro")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    rerender(
      <ProcessingState
        locale="en"
        elapsedMs={8000}
        showHint
        showCancel
        status="long_running"
        onCancel={noop}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/taking longer than usual/i);
  });

  it("renders inserted success as a compact confirmation", () => {
    render(
      <SuccessState
        text="hello"
        output="inserted"
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
        output="copied"
        locale="vi"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
        onInsert={noop}
      />,
    );
    expect(screen.getByText(/chưa thể chèn/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy|sao chép/i })).toBeInTheDocument();
  });

  it("lets manual-mode users edit the preview and press Enter to insert", async () => {
    const onInsert = vi.fn();
    render(
      <SuccessState
        text="hello"
        output="preview"
        locale="en"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
        onInsert={onInsert}
      />,
    );
    expect(screen.getByText("Result preview")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't insert the result")).not.toBeInTheDocument();
    const preview = screen.getByRole("textbox", { name: /result preview/i });
    expect(preview).toHaveFocus();
    await act(async () => {
      preview.focus();
      preview.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onInsert).toHaveBeenCalledWith("hello");
  });

  it("keeps intentional preview separate from a typed insertion failure", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <SuccessState
        text="hello"
        output="preview"
        locale="en"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
        onInsert={noop}
      />,
    );
    expect(screen.getByText("Result preview")).toBeInTheDocument();

    rerender(
      <ErrorState
        error={{ code: "insertion_failed", recoverable: true, detail: "focus restore failed" }}
        locale="en"
        onRetry={onRetry}
        onOpenSettings={noop}
        onHide={noop}
      />,
    );

    expect(screen.queryByText("Result preview")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't insert the result")).toBeInTheDocument();
    expect(screen.getByText("focus restore failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the default profile badge even when a success event includes it", () => {
    render(
      <SuccessState
        text="hello"
        output="preview"
        profile={{ id: "natural", name: "Natural" }}
        locale="en"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
        onInsert={noop}
      />,
    );

    expect(screen.queryByTestId("overlay-profile-badge")).not.toBeInTheDocument();
  });

  it("keeps a non-default profile badge visible after the preview is edited", () => {
    const { rerender } = render(
      <SuccessState
        text="hello"
        output="preview"
        profile={{ id: "email", name: "Email" }}
        locale="en"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
        onInsert={noop}
      />,
    );
    const preview = screen.getByRole("textbox", { name: /result preview/i });
    fireEvent.change(preview, { target: { value: "edited" } });

    rerender(
      <SuccessState
        text="updated"
        output="preview"
        profile={{ id: "email", name: "Email" }}
        locale="en"
        onCopy={noop}
        onRetry={noop}
        onHide={noop}
        onInsert={noop}
      />,
    );

    expect(screen.getByTestId("overlay-profile-badge")).toHaveTextContent("Email");
    expect(screen.getByRole("textbox", { name: /result preview/i })).toHaveValue("edited");
  });

  it("renders typed errors with localized recovery", () => {
    const onOpenSettings = vi.fn();
    render(
      <ErrorState
        error={{ code: "microphone_device", recoverable: true, detail: "device unavailable" }}
        locale="vi"
        onRetry={noop}
        onOpenSettings={onOpenSettings}
        onHide={noop}
      />,
    );
    expect(screen.getByText(/không thể dùng micro/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /micro|cài đặt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /đóng|close/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cài đặt/i }));
    expect(onOpenSettings).toHaveBeenCalledWith("voice");
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
