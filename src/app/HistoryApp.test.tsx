import { render, screen, waitFor } from "@testing-library/react";
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
  platformInfo: vi.fn(),
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
    platformInfo: mocks.platformInfo,
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
    mocks.platformInfo.mockResolvedValue({ os: "windows" });
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

  it("calls historyInsert when user clicks a card", async () => {
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Translate this to English please.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Translate this to English please."));
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

  it("renders empty state when history list is empty", async () => {
    mocks.historyList.mockResolvedValue([]);
    render(<HistoryApp />);

    await waitFor(() => {
      expect(screen.getByText("Chưa có lịch sử giọng nói")).toBeInTheDocument();
    });
  });
});
