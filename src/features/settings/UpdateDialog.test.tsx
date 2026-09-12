import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateDialog } from "./UpdateDialog";

type FakeEvent = {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number; chunkLength?: number };
};

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  relaunch: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mocks.openUrl,
}));

function renderDialog() {
  return render(
    <UpdateDialog
      latestVersion="v0.1.3"
      releaseUrl="https://github.com/quangtruong2003/VTP/releases/tag/v0.1.3"
      locale="en"
      onClose={() => {}}
    />,
  );
}

describe("UpdateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.relaunch.mockResolvedValue(undefined);
    mocks.openUrl.mockResolvedValue(undefined);
  });

  it("shows release notes and installs on confirmation", async () => {
    const user = userEvent.setup();
    let onEvent!: (event: FakeEvent) => void;
    let resolveDownload!: () => void;
    mocks.check.mockResolvedValue({
      version: "v0.1.3",
      body: "Faster startup",
      downloadAndInstall: (cb: (event: FakeEvent) => void) =>
        new Promise<void>((resolve) => {
          onEvent = cb;
          resolveDownload = resolve;
        }),
    });
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("Update to v0.1.3 available")).toBeInTheDocument(),
    );
    expect(screen.getByText("Faster startup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Update now" }));
    onEvent({ event: "Started", data: { contentLength: 100 } });
    onEvent({ event: "Progress", data: { chunkLength: 50 } });
    await waitFor(() =>
      expect(screen.getByText("Downloading… 50%")).toBeInTheDocument(),
    );

    onEvent({ event: "Finished" });
    await waitFor(() =>
      expect(screen.getByText("Installing…")).toBeInTheDocument(),
    );

    resolveDownload();
    await waitFor(() =>
      expect(screen.getByText("Update installed — restarting…")).toBeInTheDocument(),
    );
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a manual download when no update package is found", async () => {
    const user = userEvent.setup();
    mocks.check.mockResolvedValue(null);
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("Update failed.")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Download manually" }));
    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://github.com/quangtruong2003/VTP/releases/tag/v0.1.3",
    );
  });

  it("reports a failed download with a manual fallback", async () => {
    const user = userEvent.setup();
    mocks.check.mockResolvedValue({
      version: "v0.1.3",
      body: null,
      downloadAndInstall: mocks.downloadAndInstall.mockRejectedValue(new Error("net")),
    });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Update now" }));
    await waitFor(() =>
      expect(screen.getByText("Update failed.")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Download manually" }),
    ).toBeInTheDocument();
  });
});
