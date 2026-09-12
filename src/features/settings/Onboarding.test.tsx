import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings, PlatformInfo, PublicSettings } from "@/lib/types";
import { Onboarding } from "./Onboarding";

const settings: AppSettings = {
  api_key_set: false,
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
const platform: PlatformInfo = { os: "windows", primary_modifier: "Ctrl" };
const snapshot = (shortcut: string): PublicSettings => ({ ...settings, api_key_set: true, shortcut });

function props(overrides: Partial<React.ComponentProps<typeof Onboarding>> = {}) {
  return {
    settings,
    devices: [{ name: "Mic A", is_default: true }],
    micLevel: 0,
    platformInfo: platform,
    locale: "en" as const,
    connectApiKey: vi.fn(async () => {}),
    onUpdateImmediate: vi.fn(),
    onRefreshDevices: vi.fn(async () => []),
    onMicTestStart: vi.fn(async () => {}),
    onMicTestStop: vi.fn(async () => {}),
    onSetShortcut: vi.fn(async (shortcut: string) => snapshot(shortcut)),
    onSetProcessShortcut: vi.fn(async (shortcut: string) => ({ ...settings, process_shortcut: shortcut })),
    onSetCancelShortcut: vi.fn(async (shortcut: string) => ({ ...settings, cancel_shortcut: shortcut })),
    onSetHistoryShortcut: vi.fn(async (shortcut: string) => ({ ...settings, history_shortcut: shortcut })),
    onSetSettingsShortcut: vi.fn(async (shortcut: string) => ({ ...settings, settings_shortcut: shortcut })),
    onShortcutCommitted: vi.fn(),
    onTryNow: vi.fn(),
    onComplete: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("Onboarding", () => {
  it("does not advance past AI connection when api key validation failed", async () => {
    render(
      <Onboarding
        {...props({ connectApiKey: vi.fn(async () => { throw new Error("invalid"); }) })}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "bad-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.queryByText("Microphone setup")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't connect Gemini. Check the key and try again.")).toBeInTheDocument();
  });

  it("focuses the in-settings test textarea before starting the real overlay path", async () => {
    let focusedAtStart: Element | null = null;
    const onTryNow = vi.fn(() => {
      focusedAtStart = document.activeElement;
    });
    render(<Onboarding {...props({ onTryNow })} />);

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "good-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      screen.getByRole("heading", { name: "Microphone setup", level: 1 }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Shortcut & output", level: 1 }),
    ).toBeInTheDocument();

    const target = screen.getByRole("textbox", { name: "VoiceToPrompt test target" });
    await userEvent.click(screen.getByRole("button", { name: "Try now" }));

    expect(onTryNow).toHaveBeenCalledTimes(1);
    expect(focusedAtStart).toBe(target);
  });

  it("shows an inline error when onboarding cannot refresh devices", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("device enumeration failed");
    });
    render(<Onboarding {...props({ onRefreshDevices: refresh })} />);

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "good-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh devices" }));

    expect(await screen.findByText("Couldn't refresh the microphone list.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate microphone test requests while starting", async () => {
    let resolveMicStart!: () => void;
    const onMicTestStart = vi.fn(() => new Promise<void>((resolve) => {
      resolveMicStart = resolve;
    }));
    render(<Onboarding {...props({ onMicTestStart })} />);

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "good-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    const testButton = screen.getByRole("button", { name: "Test microphone" });
    await userEvent.click(testButton);
    await userEvent.click(testButton);

    expect(onMicTestStart).toHaveBeenCalledTimes(1);
    expect(testButton).toBeDisabled();

    resolveMicStart();
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop test" })).toBeInTheDocument());
  });

  it("offers a completion action after setup", async () => {
    const onComplete = vi.fn(async () => {});
    render(<Onboarding {...props({ onComplete })} />);
    await userEvent.type(screen.getByPlaceholderText(/AIza/), "good-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps onboarding visible when completing setup fails", async () => {
    const onComplete = vi.fn(async () => {
      throw new Error("settings refresh failed");
    });
    render(<Onboarding {...props({ onComplete })} />);

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "good-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete" }));

    expect(await screen.findByText("Couldn't finish setup. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shortcut & output", level: 1 })).toBeInTheDocument();
  });

  it("keeps one output path enabled when auto-insert is turned off", async () => {
    const onUpdateImmediate = vi.fn();
    render(
      <Onboarding
        {...props({
          settings: { ...settings, copy_to_clipboard: false, paste_automatically: true },
          onUpdateImmediate,
        })}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "good-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("switch", { name: "Insert result automatically" }));

    expect(onUpdateImmediate).toHaveBeenCalledWith({
      paste_automatically: false,
      copy_to_clipboard: true,
    });
  });
});
