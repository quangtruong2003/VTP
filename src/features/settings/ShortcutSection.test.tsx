import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings, PlatformInfo, PublicSettings } from "@/lib/types";
import { ShortcutSection } from "./ShortcutSection";

const settings: AppSettings = {
  api_key_set: true,
  model: "gemini-2.0-flash",
  system_prompt: "",
  temperature: 0.7,
  max_output_tokens: 2048,
  language: "auto",
  shortcut: "Ctrl+Shift+Space",
  shortcut_mode: "toggle",
  process_shortcut: "",
  cancel_shortcut: "Escape",
  history_shortcut: "Alt+V",
  settings_shortcut: "Alt+S",
  copy_to_clipboard: true,
  paste_automatically: true,
  device_name: null,
  show_history: true,
  ui_locale: "en",
};

const platform: PlatformInfo = { os: "windows", primary_modifier: "Ctrl" };

function returned(patch: Partial<AppSettings> = {}): PublicSettings {
  return { ...settings, ...patch };
}

function renderSection(overrides: {
  settings?: Partial<AppSettings>;
  setRecord?: (shortcut: string) => Promise<PublicSettings>;
  setProcess?: (shortcut: string) => Promise<PublicSettings>;
  setCancel?: (shortcut: string) => Promise<PublicSettings>;
  setHistory?: (shortcut: string) => Promise<PublicSettings>;
  setSettings?: (shortcut: string) => Promise<PublicSettings>;
  onCommitted?: (snapshot: PublicSettings) => void;
  onUpdateImmediate?: (patch: Partial<AppSettings>) => void;
} = {}) {
  const setRecord = overrides.setRecord ?? vi.fn(async (shortcut: string) => returned({ shortcut }));
  const setProcess = overrides.setProcess ?? vi.fn(async (shortcut: string) => returned({ process_shortcut: shortcut }));
  const setCancel = overrides.setCancel ?? vi.fn(async (shortcut: string) => returned({ cancel_shortcut: shortcut }));
  const setHistory = overrides.setHistory ?? vi.fn(async (shortcut: string) => returned({ history_shortcut: shortcut }));
  const setSettings = overrides.setSettings ?? vi.fn(async (shortcut: string) => returned({ settings_shortcut: shortcut }));
  render(
    <ShortcutSection
      settings={{ ...settings, ...overrides.settings }}
      platformInfo={platform}
      locale="en"
      onSetShortcut={setRecord}
      onSetProcessShortcut={setProcess}
      onSetCancelShortcut={setCancel}
      onSetHistoryShortcut={setHistory}
      onSetSettingsShortcut={setSettings}
      onCommitted={overrides.onCommitted ?? (() => {})}
      onUpdateImmediate={overrides.onUpdateImmediate ?? (() => {})}
    />,
  );
  return { setRecord, setProcess, setCancel, setHistory, setSettings };
}

describe("ShortcutSection", () => {
  it("switches the main shortcut to hold-to-talk mode", async () => {
    const onUpdateImmediate = vi.fn();
    renderSection({ onUpdateImmediate });

    await userEvent.click(screen.getByRole("button", { name: "Hold to talk" }));

    expect(onUpdateImmediate).toHaveBeenCalledWith({ shortcut_mode: "hold" });
  });
  it("Escape cancels record-shortcut capture without committing", async () => {
    const { setRecord } = renderSection();

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*start \/ finish recording/i }));
    expect(screen.getByText("Press a new key combination…")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByText("Press a new key combination…")).not.toBeInTheDocument();
    expect(setRecord).not.toHaveBeenCalled();
    expect(screen.getByText("Space")).toBeInTheDocument();
  });

  it("commits a valid record shortcut from the returned backend snapshot", async () => {
    const onCommitted = vi.fn();
    const setRecord = vi.fn(async () => returned({ shortcut: "Ctrl+Alt+K" }));
    renderSection({ setRecord, onCommitted });

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*start \/ finish recording/i }));
    await userEvent.keyboard("{Control>}{Alt>}k{/Alt}{/Control}");

    expect(setRecord).toHaveBeenCalledWith("Ctrl+Alt+K");
    expect(await screen.findByText("K")).toBeInTheDocument();
    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ shortcut: "Ctrl+Alt+K" }));
  });

  it("does not configure bare Enter as a global session shortcut", async () => {
    const setProcess = vi.fn(async () => returned({ process_shortcut: "Enter" }));
    renderSection({ setProcess });

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*process recording/i }));
    await userEvent.keyboard("{Enter}");

    expect(setProcess).not.toHaveBeenCalled();
    expect(await screen.findByText("That key combination isn't supported.")).toBeInTheDocument();
  });

  it("allows bare Escape for the cancel session shortcut", async () => {
    const setCancel = vi.fn(async () => returned({ cancel_shortcut: "Escape" }));
    renderSection({ setCancel });

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*cancel recording/i }));
    await userEvent.keyboard("{Escape}");
    expect(setCancel).toHaveBeenCalledWith("Escape");
  });

  it("clears the optional process shortcut", async () => {
    const setProcess = vi.fn(async () => returned({ process_shortcut: "" }));
    renderSection({
      settings: { process_shortcut: "Ctrl+Enter" },
      setProcess,
    });

    await userEvent.click(screen.getByRole("button", { name: /clear.*process recording/i }));

    expect(setProcess).toHaveBeenCalledWith("");
  });

  it("keeps the previous record shortcut visible when registration fails", async () => {
    const setRecord = vi.fn(async () => {
      throw new Error("shortcut conflict");
    });
    renderSection({ setRecord });

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*start \/ finish recording/i }));
    await userEvent.keyboard("{Control>}{Alt>}k{/Alt}{/Control}");

    expect(await screen.findByText("Shortcut unavailable")).toBeInTheDocument();
    expect(screen.getByText("Space")).toBeInTheDocument();
    expect(screen.queryByText("K")).not.toBeInTheDocument();
    expect(screen.getByText(/Windows/i)).toBeInTheDocument();
  });

  it("commits a valid history shortcut from the returned backend snapshot", async () => {
    const onCommitted = vi.fn();
    const setHistory = vi.fn(async () => returned({ history_shortcut: "Ctrl+Alt+H" }));
    renderSection({ setHistory, onCommitted });

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*history window/i }));
    await userEvent.keyboard("{Control>}{Alt>}h{/Alt}{/Control}");

    expect(setHistory).toHaveBeenCalledWith("Ctrl+Alt+H");
    expect(await screen.findByText("H")).toBeInTheDocument();
    expect(onCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ history_shortcut: "Ctrl+Alt+H" }),
    );
  });

  it("commits a valid settings shortcut from the returned backend snapshot", async () => {
    const onCommitted = vi.fn();
    const setSettings = vi.fn(async () => returned({ settings_shortcut: "Ctrl+Alt+S" }));
    renderSection({ setSettings, onCommitted });

    await userEvent.click(screen.getByRole("button", { name: /change shortcut.*settings window/i }));
    await userEvent.keyboard("{Control>}{Alt>}s{/Alt}{/Control}");

    expect(setSettings).toHaveBeenCalledWith("Ctrl+Alt+S");
    expect(await screen.findByText("S")).toBeInTheDocument();
    expect(onCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ settings_shortcut: "Ctrl+Alt+S" }),
    );
  });
});
