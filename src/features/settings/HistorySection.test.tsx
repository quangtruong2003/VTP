import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "@/lib/types";
import { HistorySection } from "./HistorySection";

const entry: HistoryEntry = {
  id: "one",
  created_at: "2026-09-04T16:00:00Z",
  duration_ms: 12_400,
  transcript_hint: "",
  response_text: "Draft a concise project update for the team.",
  model: "gemini-2.0-flash",
  status: "success",
  error_message: null,
};

describe("HistorySection", () => {
  it("requires confirmation before clearing history", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => {});
    render(
      <HistorySection
        entries={[entry]}
        locale="en"
        onCopy={async () => {}}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear history" }));
    expect(onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("uses the Rust-backed copy callback and renders the empty state", async () => {
    const onCopy = vi.fn(async () => {});
    const { rerender } = render(
      <HistorySection
        entries={[entry]}
        locale="en"
        onCopy={onCopy}
        onClear={async () => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy result" }));
    expect(onCopy).toHaveBeenCalledWith("one");

    rerender(
      <HistorySection
        entries={[]}
        locale="en"
        onCopy={onCopy}
        onClear={async () => {}}
      />,
    );
    expect(screen.getByText("No content yet")).toBeInTheDocument();
  });
});
