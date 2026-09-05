import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/lib/types";
import { createAutosaveController, createAutosaveQueue } from "./autosave";

const base: AppSettings = {
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
  ui_locale: "system",
};

describe("autosave", () => {
  it("never lets an older save resolve over a newer snapshot", async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => (releaseFirst = resolve));
    const save = vi.fn(async (s: AppSettings) => {
      calls.push(s.system_prompt);
      if (s.system_prompt === "a") await first;
      return s;
    });
    const queue = createAutosaveQueue(save);
    queue.enqueue({ ...base, system_prompt: "a" });
    queue.enqueue({ ...base, system_prompt: "b" });
    queue.enqueue({ ...base, system_prompt: "c" });
    releaseFirst();
    await queue.flush();
    expect(calls).toEqual(["a", "c"]);
  });

  it("debounces text saves for 400ms while immediate saves bypass the debounce", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const queue = createAutosaveQueue(async (s: AppSettings) => {
      calls.push(s.system_prompt);
      return s;
    });
    const controller = createAutosaveController(queue, 400);

    controller.saveDebounced({ ...base, system_prompt: "draft" });
    await vi.advanceTimersByTimeAsync(399);
    expect(calls).toEqual([]);

    controller.saveImmediate({ ...base, system_prompt: "immediate" });
    await queue.flush();
    expect(calls).toEqual(["immediate"]);

    controller.saveDebounced({ ...base, system_prompt: "final" });
    await vi.advanceTimersByTimeAsync(400);
    await queue.flush();
    expect(calls[calls.length - 1]).toBe("final");
    vi.useRealTimers();
  });
});
