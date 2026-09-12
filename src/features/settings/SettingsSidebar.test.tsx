import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar } from "./SettingsSidebar";

const mocks = vi.hoisted(() => ({
  appVersion: vi.fn(),
  checkUpdate: vi.fn(),
  check: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  settingsApi: {
    appVersion: mocks.appVersion,
    checkUpdate: mocks.checkUpdate,
  },
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mocks.openUrl,
}));

function renderSidebar() {
  return render(
    <SettingsSidebar section="general" onSectionChange={() => {}} locale="en" />,
  );
}

describe("SettingsSidebar version and updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appVersion.mockResolvedValue("0.1.2");
    mocks.check.mockResolvedValue(null);
    mocks.openUrl.mockResolvedValue(undefined);
  });

  it("shows the app version without the product header", async () => {
    renderSidebar();

    await waitFor(() => expect(screen.getByText("v0.1.2")).toBeInTheDocument());
    expect(screen.queryByText("VoiceToPrompt")).not.toBeInTheDocument();
  });

  it("opens the update dialog when an update is available", async () => {
    const user = userEvent.setup();
    mocks.checkUpdate.mockResolvedValue({
      current_version: "0.1.2",
      latest_version: "v0.1.3",
      update_available: true,
      release_url: "https://github.com/quangtruong2003/VTP/releases/tag/v0.1.3",
    });
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() =>
      expect(screen.getByText("Update available: v0.1.3")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("Update to v0.1.3 available")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Download manually" }));
    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://github.com/quangtruong2003/VTP/releases/tag/v0.1.3",
    );
  });

  it("reports up-to-date and failed checks", async () => {
    const user = userEvent.setup();
    mocks.checkUpdate.mockResolvedValue({
      current_version: "0.1.2",
      latest_version: "v0.1.2",
      update_available: false,
      release_url: "https://github.com/quangtruong2003/VTP/releases",
    });
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() =>
      expect(screen.getByText("You're up to date")).toBeInTheDocument(),
    );
  });

  it("shows a retryable error when the check fails", async () => {
    const user = userEvent.setup();
    mocks.checkUpdate.mockRejectedValue(new Error("offline"));
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't check for updates")).toBeInTheDocument(),
    );
    // The same button retries the check.
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeInTheDocument();
  });
});
