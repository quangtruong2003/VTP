import { render, screen } from "@testing-library/react";
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
  process_shortcut: "Enter",
  cancel_shortcut: "Escape",
  copy_to_clipboard: true,
  paste_automatically: true,
  device_name: null,
  show_history: true,
  start_recording_on_open: true,
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
    onShortcutCommitted: vi.fn(),
    onTryNow: vi.fn(),
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
});
