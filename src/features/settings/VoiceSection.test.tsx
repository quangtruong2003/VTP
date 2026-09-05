import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings, PlatformInfo } from "@/lib/types";
import { GeneralSection } from "./GeneralSection";
import { OutputSection } from "./OutputSection";
import { VoiceSection } from "./VoiceSection";

const settings: AppSettings = {
  api_key_set: true,
  model: "gemini-2.0-flash",
  system_prompt: "",
  temperature: 0.7,
  max_output_tokens: 2048,
  language: "auto",
  shortcut: "CmdOrCtrl+Shift+Space",
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

 describe("Task 9 settings sections", () => {
  it("shows system default first and reports detected audio", () => {
    render(
      <VoiceSection
        settings={settings}
        devices={[{ name: "Mic A", is_default: true }]}
        micLevel={140}
        locale="en"
        onUpdateImmediate={() => {}}
        onRefreshDevices={async () => []}
        onMicTestStart={async () => {}}
        onMicTestStop={async () => {}}
      />,
    );

    expect(screen.getByText("System default")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mic A (default)" })).toBeInTheDocument();
    expect(screen.getByText("Receiving audio")).toBeInTheDocument();
    expect(screen.queryByText("Start recording immediately")).not.toBeInTheDocument();
  });

  it("stops an active microphone test when the voice section unmounts", async () => {
    const stop = vi.fn(async () => {});
    const { unmount } = render(
      <VoiceSection
        settings={settings}
        devices={[]}
        micLevel={0}
        locale="en"
        onUpdateImmediate={() => {}}
        onRefreshDevices={async () => []}
        onMicTestStart={async () => {}}
        onMicTestStop={stop}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Test microphone" }));
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("general readiness keeps legacy manual-start preference out of the UI", () => {
    render(
      <GeneralSection
        settings={settings}
        platformInfo={platform}
        devices={[{ name: "Mic A", is_default: true }]}
        locale="en"
        onUpdateImmediate={() => {}}
        onTryVoice={() => {}}
      />,
    );

    expect(screen.getByText("Gemini connected")).toBeInTheDocument();
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Start recording immediately" })).not.toBeInTheDocument();
  });

  it("output switches save immediately", async () => {
    const update = vi.fn();
    render(
      <OutputSection settings={settings} locale="en" onUpdateImmediate={update} />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Keep result in clipboard" }));
    expect(update).toHaveBeenCalledWith({ copy_to_clipboard: false });
  });
});
