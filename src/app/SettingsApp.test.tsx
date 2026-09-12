import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, HistoryEntry, PublicSettings } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  useSettingsStore: vi.fn(),
  get: vi.fn(),
  connectApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  listModels: vi.fn(),
  setShortcut: vi.fn(),
  setProcessShortcut: vi.fn(),
  setCancelShortcut: vi.fn(),
  historyList: vi.fn(),
  historyCopy: vi.fn(),
  historyClear: vi.fn(),
  openHistory: vi.fn(),
  appVersion: vi.fn(),
  checkUpdate: vi.fn(),
  onSettingsSection: vi.fn(),
  onMicLevel: vi.fn(),
  toggle: vi.fn(),
  settingsSectionHandler: undefined as ((section: string) => void) | undefined,
}));

vi.mock("@/features/settings/useSettingsStore", () => ({
  useSettingsStore: () => mocks.useSettingsStore(),
}));

vi.mock("@/lib/settings", () => ({
  settingsApi: {
    get: mocks.get,
    connectApiKey: mocks.connectApiKey,
    deleteApiKey: mocks.deleteApiKey,
    listModels: mocks.listModels,
    setShortcut: mocks.setShortcut,
    setProcessShortcut: mocks.setProcessShortcut,
    setCancelShortcut: mocks.setCancelShortcut,
    setHistoryShortcut: vi.fn(),
    setSettingsShortcut: vi.fn(),
    historyList: mocks.historyList,
    historyCopy: mocks.historyCopy,
    historyClear: mocks.historyClear,
    openHistory: mocks.openHistory,
    appVersion: mocks.appVersion,
    checkUpdate: mocks.checkUpdate,
  },
  onSettingsSection: mocks.onSettingsSection,
  onMicLevel: mocks.onMicLevel,
}));

vi.mock("@/lib/overlay", () => ({
  overlayApi: {
    toggle: mocks.toggle,
  },
}));

import { SettingsApp } from "./SettingsApp";

const baseSettings: AppSettings = {
  api_key_set: true,
  model: "gemini-2.0-flash",
  system_prompt: "",
  temperature: 0.7,
  max_output_tokens: 2048,
  language: "auto",
  shortcut: "Ctrl+Shift+Space",
  shortcut_mode: "toggle",
  process_shortcut: "Enter",
  cancel_shortcut: "Escape",
  copy_to_clipboard: true,
  paste_automatically: true,
  device_name: null,
  show_history: true,
  ui_locale: "en",
};

const entry: HistoryEntry = {
  id: "history-one",
  created_at: "2026-09-04T16:00:00Z",
  duration_ms: 3_200,
  transcript_hint: "",
  response_text: "History result from the production settings route.",
  model: "gemini-2.0-flash",
  status: "success",
  error_message: null,
};

function storeFor(settings: AppSettings) {
  return {
    settings,
    platformInfo: { os: "windows", primary_modifier: "Ctrl" },
    devices: [{ name: "Mic A", is_default: true }],
    micLevel: 0,
    loading: false,
    loadError: null,
    autosaveStatus: "idle" as const,
    retryAutosave: vi.fn(),
    updateImmediate: vi.fn(),
    updateDebounced: vi.fn(),
    replaceSettings: vi.fn(),
    refreshDevices: vi.fn(async () => []),
    startMicTest: vi.fn(async () => {}),
    stopMicTest: vi.fn(async () => {}),
  };
}

describe("SettingsApp Task 12 production integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsSectionHandler = undefined;
    mocks.historyList.mockResolvedValue([entry]);
    mocks.historyCopy.mockResolvedValue(undefined);
    mocks.historyClear.mockResolvedValue(undefined);
    mocks.openHistory.mockResolvedValue(undefined);
    mocks.appVersion.mockResolvedValue("0.1.2");
    mocks.checkUpdate.mockResolvedValue({
      current_version: "0.1.2",
      latest_version: "0.1.2",
      update_available: false,
      release_url: "https://github.com/quangtruong2003/VTP/releases",
    });
    mocks.get.mockResolvedValue({ ...baseSettings } satisfies PublicSettings);
    mocks.connectApiKey.mockResolvedValue(undefined);
    mocks.listModels.mockResolvedValue([]);
    mocks.setShortcut.mockImplementation(async (shortcut: string) => ({
      ...baseSettings,
      shortcut,
    }));
    mocks.onSettingsSection.mockImplementation(async (callback: (section: string) => void) => {
      mocks.settingsSectionHandler = callback;
      return vi.fn();
    });
    mocks.onMicLevel.mockResolvedValue(vi.fn());
  });

  it("shows a lightweight loading shell while settings are loading", () => {
    const store = storeFor(baseSettings);
    mocks.useSettingsStore.mockReturnValue({
      ...store,
      settings: null,
      loading: true,
    });

    render(<SettingsApp />);

    expect(screen.getByRole("status", { name: "Loading settings" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("shows a localized fallback when settings cannot be loaded", () => {
    const store = storeFor(baseSettings);
    mocks.useSettingsStore.mockReturnValue({
      ...store,
      settings: null,
      loading: false,
      loadError: null,
    });

    render(<SettingsApp />);

    expect(screen.getByText("Couldn't load settings.")).toBeInTheDocument();
  });

  it("renders onboarding instead of the full settings shell until Gemini is connected", () => {
    mocks.useSettingsStore.mockReturnValue(storeFor({ ...baseSettings, api_key_set: false }));
    render(<SettingsApp />);

    expect(screen.getByRole("heading", { name: "Connect AI", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("opens the requested section when the settings window is created lazily", () => {
    window.history.replaceState({}, "", "/settings.html?section=voice");
    mocks.useSettingsStore.mockReturnValue(storeFor(baseSettings));

    try {
      render(<SettingsApp />);

      expect(screen.getByText("Test microphone")).toBeInTheDocument();
    } finally {
      window.history.replaceState({}, "", "/settings.html");
    }
  });

  it("routes tray History events to privacy controls and wires open/clear", async () => {
    mocks.useSettingsStore.mockReturnValue(storeFor(baseSettings));
    render(<SettingsApp />);

    await waitFor(() => expect(mocks.settingsSectionHandler).toBeTypeOf("function"));
    await act(async () => {
      mocks.settingsSectionHandler?.("history");
    });

    expect(screen.queryByText(entry.response_text)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open History" }));
    expect(mocks.openHistory).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    expect(mocks.historyClear).toHaveBeenCalledTimes(1);

    await act(async () => {
      mocks.settingsSectionHandler?.("voice");
    });
    expect(screen.getByText("Test microphone")).toBeInTheDocument();
  });

  it("uses the lifecycle-aware overlay toggle for onboarding Try now", async () => {
    mocks.useSettingsStore.mockReturnValue(storeFor({ ...baseSettings, api_key_set: false }));
    render(<SettingsApp />);

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "valid-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Try now" }));

    expect(mocks.toggle).toHaveBeenCalledTimes(1);
  });

  it("keeps onboarding visible after key refresh until Complete is pressed", async () => {
    const store = storeFor({ ...baseSettings, api_key_set: false });
    store.replaceSettings.mockImplementation((snapshot: PublicSettings) => {
      store.settings = snapshot;
    });
    mocks.useSettingsStore.mockReturnValue(store);
    const { rerender } = render(<SettingsApp />);

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "valid-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));

    rerender(<SettingsApp />);
    expect(screen.getByRole("heading", { name: "Microphone setup", level: 1 })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));
    rerender(<SettingsApp />);

    expect(screen.getByRole("navigation", { name: "Settings" })).toBeInTheDocument();
  });
});
