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

  it("shows an inline error when the microphone test cannot start", async () => {
    const start = vi.fn(async () => {
      throw new Error("device unavailable");
    });
    render(
      <VoiceSection
        settings={settings}
        devices={[]}
        micLevel={0}
        locale="en"
        onUpdateImmediate={() => {}}
        onRefreshDevices={async () => []}
        onMicTestStart={start}
        onMicTestStop={async () => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Test microphone" }));

    expect(await screen.findByText("Couldn't start the microphone test. Check the selected device.")).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("shows an inline error when refreshing devices fails", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("device enumeration failed");
    });
    render(
      <VoiceSection
        settings={settings}
        devices={[]}
        micLevel={0}
        locale="en"
        onUpdateImmediate={() => {}}
        onRefreshDevices={refresh}
        onMicTestStart={async () => {}}
        onMicTestStop={async () => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Refresh devices" }));

    expect(await screen.findByText("Couldn't refresh the microphone list.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
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
  });

  it("general section renders Start with Windows toggle and updates immediately", async () => {
    const update = vi.fn();
    render(
      <GeneralSection
        settings={{ ...settings, start_with_windows: false }}
        platformInfo={platform}
        devices={[{ name: "Mic A", is_default: true }]}
        locale="en"
        onUpdateImmediate={update}
        onTryVoice={() => {}}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Start with Windows" });
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ start_with_windows: true });
  });

  it("output switches save immediately", async () => {
    const update = vi.fn();
    render(
      <OutputSection settings={settings} locale="en" onUpdateImmediate={update} />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Keep result in clipboard" }));
    expect(update).toHaveBeenCalledWith({ copy_to_clipboard: false });
  });

  it("keeps at least one automatic output path enabled", async () => {
    const update = vi.fn();
    const { rerender } = render(
      <OutputSection settings={settings} locale="en" onUpdateImmediate={update} />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Keep result in clipboard" }));
    expect(update).toHaveBeenLastCalledWith({ copy_to_clipboard: false });

    rerender(
      <OutputSection
        settings={{ ...settings, copy_to_clipboard: false }}
        locale="en"
        onUpdateImmediate={update}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Insert result automatically" }));
    expect(update).toHaveBeenLastCalledWith({
      paste_automatically: false,
      copy_to_clipboard: true,
    });
  });
});
