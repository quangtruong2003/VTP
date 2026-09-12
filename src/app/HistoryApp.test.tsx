import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "@/lib/types";

  const mocks = vi.hoisted(() => ({
  historyList: vi.fn(),
  historyCopy: vi.fn(),
  historyDelete: vi.fn(),
  historyInsert: vi.fn(),
  historyClear: vi.fn(),
  closeHistory: vi.fn(),
  copyText: vi.fn(),
  get: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@/lib/settings", () => ({
  settingsApi: {
    historyList: mocks.historyList,
    historyCopy: mocks.historyCopy,
    historyDelete: mocks.historyDelete,
    historyInsert: mocks.historyInsert,
    historyClear: mocks.historyClear,
    closeHistory: mocks.closeHistory,
    copyText: mocks.copyText,
    get: mocks.get,
  },
}));

import { HistoryApp } from "./HistoryApp";

const sampleEntries: HistoryEntry[] = [
  {
    id: "entry-1",
    created_at: new Date(Date.now() - 60000).toISOString(),
    duration_ms: 1800,
    transcript_hint: "Dịch sang tiếng Anh",
    response_text: "Translate this to English please.",
    model: "gemini-2.0-flash",
    status: "success",
    error_message: null,
  },
  {
    id: "entry-2",
    created_at: new Date(Date.now() - 3600000).toISOString(),
    duration_ms: 3200,
    transcript_hint: "Viết email xin nghỉ phép",
    response_text: "Kính gửi anh/chị, em xin phép nghỉ ốm hôm nay.",
    model: "gemini-2.5-flash",
    status: "success",
    error_message: null,
  },
];

describe("HistoryApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockResolvedValue(() => {});
    mocks.get.mockResolvedValue({ ui_locale: "vi" });
    mocks.historyList.mockResolvedValue(sampleEntries);
    mocks.historyInsert.mockResolvedValue(undefined);
    mocks.historyCopy.mockResolvedValue(undefined);
    mocks.historyDelete.mockResolvedValue(undefined);
    mocks.historyClear.mockResolvedValue(undefined);
  });

  it("renders entries with transcript hints and metadata", async () => {
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Translate this to English please.")).toBeInTheDocument();
    });

    expect(screen.getByText('"Dịch sang tiếng Anh"')).toBeInTheDocument();
    expect(screen.getByText("gemini-2.0-flash")).toBeInTheDocument();
    expect(screen.getByText("Kính gửi anh/chị, em xin phép nghỉ ốm hôm nay.")).toBeInTheDocument();
  });

  it("shows a loading state before the first history response", async () => {
    let resolveList!: (entries: HistoryEntry[]) => void;
    mocks.historyList.mockImplementationOnce(() => new Promise((resolve) => {
      resolveList = resolve;
    }));

    render(<HistoryApp />);

    expect(screen.getByRole("status", { name: "Đang tải lịch sử giọng nói" })).toBeInTheDocument();
    expect(screen.queryByText("Chưa có lịch sử giọng nói")).not.toBeInTheDocument();
    await waitFor(() => expect(resolveList).toBeTypeOf("function"));

    await act(async () => {
      resolveList(sampleEntries);
      await Promise.resolve();
    });

    expect(await screen.findByText("Translate this to English please.")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Đang tải lịch sử giọng nói" })).not.toBeInTheDocument();
  });

  it("shows a retry state when the initial history load fails", async () => {
    mocks.historyList.mockRejectedValueOnce({
      code: "unknown",
      recoverable: true,
      detail: "history file is unavailable",
    });
    render(<HistoryApp />);

    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-error-code", "unknown");
    expect(error).toHaveTextContent("history file is unavailable");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Translate this to English please.")).toBeInTheDocument();
  });

  it("keeps the full transcript visible in history", async () => {
    const transcript = "từ ".repeat(60).trim();
    mocks.historyList.mockResolvedValue([
      {
        ...sampleEntries[0],
        transcript_hint: transcript,
      },
    ]);

    render(<HistoryApp />);

    const transcriptNode = await screen.findByText(`"${transcript}"`);
    expect(transcriptNode).not.toHaveClass("line-clamp-1");
    expect(transcriptNode).toHaveClass("whitespace-pre-wrap");
  });

  it("filters entries as user types in search", async () => {
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Translate this to English please.")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Tìm kiếm câu nói hoặc kết quả…");
    await userEvent.type(searchInput, "email");

    expect(screen.queryByText("Translate this to English please.")).not.toBeInTheDocument();
    expect(screen.getByText("Kính gửi anh/chị, em xin phép nghỉ ốm hôm nay.")).toBeInTheDocument();
  });

  it("does not expose a status filter for success-only history", async () => {
    render(<HistoryApp />);

    await screen.findByText("Translate this to English please.");

    expect(screen.queryByRole("button", { name: /^Tất cả$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Thành công$/ })).not.toBeInTheDocument();
  });

  it("calls historyInsert when user clicks a card", async () => {
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Translate this to English please.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Translate this to English please."));
    expect(mocks.historyInsert).toHaveBeenCalledWith("Translate this to English please.");
  });

  it("inserts a focused card with Enter without relying on a mouse click", async () => {
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    const card = screen.getByRole("button", { name: /Translate this to English please/ });
    card.focus();
    await userEvent.keyboard("{Enter}");

    expect(mocks.historyInsert).toHaveBeenCalledTimes(1);
    expect(mocks.historyInsert).toHaveBeenCalledWith("Translate this to English please.");
  });

  it("calls historyCopy when clicking copy button", async () => {
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Translate this to English please.")).toBeInTheDocument();
    });

    const copyButtons = screen.getAllByRole("button", { name: "Sao chép" });
    await userEvent.click(copyButtons[0]);
    expect(mocks.historyCopy).toHaveBeenCalledWith("entry-1");
  });

  it("shows a typed error when copying a history item fails", async () => {
    mocks.historyCopy.mockRejectedValue({
      code: "clipboard_failed",
      recoverable: true,
      detail: "clipboard is unavailable",
    });
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    await userEvent.click(screen.getAllByRole("button", { name: "Sao chép" })[0]);

    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-error-code", "clipboard_failed");
    expect(error).toHaveTextContent("clipboard is unavailable");
  });

  it("shows a typed error when deleting a history item fails", async () => {
    mocks.historyDelete.mockRejectedValue({
      code: "unknown",
      recoverable: true,
      detail: "history file is unavailable",
    });
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    await userEvent.click(screen.getAllByRole("button", { name: "Xóa" })[0]);

    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-error-code", "unknown");
    expect(error).toHaveTextContent("history file is unavailable");
  });

  it("prevents duplicate copy requests while copying", async () => {
    let resolveCopy!: () => void;
    mocks.historyCopy.mockImplementation(() => new Promise<void>((resolve) => {
      resolveCopy = resolve;
    }));
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    const copyButton = screen.getAllByRole("button", { name: "Sao chép" })[0];
    await userEvent.click(copyButton);
    await userEvent.click(copyButton);

    expect(mocks.historyCopy).toHaveBeenCalledTimes(1);
    expect(copyButton).toBeDisabled();

    resolveCopy();
    await waitFor(() => expect(copyButton).toBeEnabled());
  });

  it("does not insert when Enter activates a card action button", async () => {
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    const copyButton = screen.getAllByRole("button", { name: "Sao chép" })[0];
    copyButton.focus();
    await userEvent.keyboard("{Enter}");

    expect(mocks.historyCopy).toHaveBeenCalledWith("entry-1");
    expect(mocks.historyInsert).not.toHaveBeenCalled();
  });

  it("renders empty state when history list is empty", async () => {
    mocks.historyList.mockResolvedValue([]);
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Chưa có lịch sử giọng nói")).toBeInTheDocument();
    });
  });

  it("refreshes when history changes", async () => {
    let changed: (() => void) | undefined;
    mocks.listen.mockImplementation(async (event: string, callback: () => void) => {
      if (event === "history://changed") changed = callback;
      return () => {};
    });
    render(<HistoryApp />);
    await waitFor(() => expect(mocks.historyList).toHaveBeenCalledTimes(1));
    mocks.historyList.mockResolvedValue([sampleEntries[1]]);
    changed?.();
    await waitFor(() => expect(mocks.historyList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Kính gửi anh/chị, em xin phép nghỉ ốm hôm nay.")).toBeInTheDocument();
  });

  it("keeps a newer history refresh when an older request resolves later", async () => {
    let changed: (() => void) | undefined;
    let resolveInitial!: (entries: HistoryEntry[]) => void;
    let resolveRefresh!: (entries: HistoryEntry[]) => void;
    mocks.listen.mockImplementation(async (event: string, callback: () => void) => {
      if (event === "history://changed") changed = callback;
      return () => {};
    });
    mocks.historyList
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveInitial = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));

    render(<HistoryApp />);
    await waitFor(() => expect(mocks.historyList).toHaveBeenCalledTimes(1));

    await act(async () => {
      changed?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.historyList).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveRefresh([sampleEntries[1]]);
      await Promise.resolve();
    });
    expect(await screen.findByText("Kính gửi anh/chị, em xin phép nghỉ ốm hôm nay.")).toBeInTheDocument();

    await act(async () => {
      resolveInitial([sampleEntries[0]]);
      await Promise.resolve();
    });
    expect(screen.getByText("Kính gửi anh/chị, em xin phép nghỉ ốm hôm nay.")).toBeInTheDocument();
    expect(screen.queryByText("Translate this to English please.")).not.toBeInTheDocument();
  });

  it("focuses the cancel button when the clear dialog opens", async () => {
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");
    await userEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog").querySelector("button")).toHaveFocus();
  });

  it("keeps keyboard focus inside the clear dialog", async () => {
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");
    await userEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));

    const dialog = screen.getByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Hủy" });
    const confirm = within(dialog).getByRole("button", { name: "Xóa lịch sử" });
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
  });

  it("resolves the system locale from the browser locale", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window.navigator, "language");
    Object.defineProperty(window.navigator, "language", { configurable: true, value: "vi-VN" });
    mocks.get.mockResolvedValue({ ui_locale: "system" });

    try {
      render(<HistoryApp />);
      expect(await screen.findByPlaceholderText("Tìm kiếm câu nói hoặc kết quả…")).toBeInTheDocument();
    } finally {
      if (descriptor) Object.defineProperty(window.navigator, "language", descriptor);
    }
  });

  it("returns focus to the clear trigger after cancelling the dialog", async () => {
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    const trigger = screen.getByRole("button", { name: "Xóa tất cả" });
    await userEvent.click(trigger);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Hủy" }));

    expect(trigger).toHaveFocus();
  });

  it("shows a typed clear error and keeps the dialog open", async () => {
    mocks.historyClear.mockRejectedValue({
      code: "unknown",
      recoverable: true,
      detail: "history file is unavailable",
    });
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    await userEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    await userEvent.click(screen.getByRole("button", { name: "Xóa lịch sử" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-error-code", "unknown");
    expect(error).toHaveTextContent("history file is unavailable");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("prevents duplicate clear requests and reports fallback insertion failures", async () => {
    let resolveClear!: () => void;
    mocks.historyClear.mockImplementation(() => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    await userEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    const confirm = screen.getByRole("button", { name: "Xóa lịch sử" });
    await userEvent.click(confirm);
    await userEvent.click(confirm);

    expect(mocks.historyClear).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    resolveClear();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the clear dialog open while clearing is pending", async () => {
    let resolveClear!: () => void;
    mocks.historyClear.mockImplementation(() => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    await userEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    await userEvent.click(screen.getByRole("button", { name: "Xóa lịch sử" }));
    await userEvent.keyboard("{Escape}");

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toBeDisabled();

    resolveClear();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps History open when both insertion and clipboard fallback fail", async () => {
    mocks.historyInsert.mockRejectedValue(new Error("target unavailable"));
    mocks.copyText.mockRejectedValue({
      code: "clipboard_failed",
      recoverable: true,
      detail: "clipboard unavailable",
    });
    render(<HistoryApp />);
    await screen.findByText("Translate this to English please.");

    await userEvent.click(screen.getByText("Translate this to English please."));

    const error = await screen.findByRole("alert");
    expect(error).toHaveAttribute("data-error-code", "clipboard_failed");
    expect(error).toHaveTextContent("clipboard unavailable");
    expect(screen.getByText("Translate this to English please.")).toBeInTheDocument();
  });
});
