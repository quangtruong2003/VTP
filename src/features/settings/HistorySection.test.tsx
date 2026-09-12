import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistorySection } from "./HistorySection";

describe("HistorySection", () => {
  it("only exposes privacy, open History, and clear History controls", async () => {
    const onEnabledChange = vi.fn(); const onOpen = vi.fn(async () => {});
    render(<HistorySection enabled locale="en" onEnabledChange={onEnabledChange} onOpen={onOpen} onClear={async () => {}} />);
    await userEvent.click(screen.getByRole("switch", { name: "Save local history" })); expect(onEnabledChange).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Open History" })); expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("requires confirmation before clearing history", async () => {
    const onClear = vi.fn(async () => {});
    render(<HistorySection enabled locale="en" onEnabledChange={() => {}} onOpen={async () => {}} onClear={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear history" })); expect(onClear).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm clear" })); expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows a typed clear error and keeps the dialog open", async () => {
    const onClear = vi.fn(async () => {
      throw { code: "unknown", recoverable: true, detail: "history file is unavailable" };
    });
    render(<HistorySection enabled locale="en" onEnabledChange={() => {}} onOpen={async () => {}} onClear={onClear} />);

    await userEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm clear" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-error-code", "unknown");
    expect(error).toHaveTextContent("history file is unavailable");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows an open error and prevents duplicate open requests", async () => {
    let rejectOpen: ((error: Error) => void) | undefined;
    const onOpen = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectOpen = reject;
        }),
    );
    render(<HistorySection enabled locale="en" onEnabledChange={() => {}} onOpen={onOpen} onClear={async () => {}} />);

    const button = screen.getByRole("button", { name: "Open History" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    rejectOpen?.(new Error("window unavailable"));
    expect(await screen.findByText("Couldn't open History. Try again.")).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("prevents duplicate clear requests while the action is pending", async () => {
    let resolveClear!: () => void;
    const onClear = vi.fn(() => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    render(<HistorySection enabled locale="en" onEnabledChange={() => {}} onOpen={async () => {}} onClear={onClear} />);

    await userEvent.click(screen.getByRole("button", { name: "Clear history" }));
    const confirm = screen.getByRole("button", { name: "Confirm clear" });
    await userEvent.click(confirm);
    await userEvent.click(confirm);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();

    resolveClear();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the clear dialog open when Escape is pressed while clearing", async () => {
    let resolveClear!: () => void;
    const onClear = vi.fn(() => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    render(<HistorySection enabled locale="en" onEnabledChange={() => {}} onOpen={async () => {}} onClear={onClear} />);

    await userEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    resolveClear();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
