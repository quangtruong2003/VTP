import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings, GeminiModelInfo } from "@/lib/types";
import { AiPromptSection } from "./AiPromptSection";

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
  ui_locale: "en",
};

const models: GeminiModelInfo[] = [
  {
    name: "gemini-2.0-flash",
    display_name: "Gemini 2.0 Flash",
    description: "Fast general model",
    input_token_limit: 1_000_000,
  },
];

function props(overrides: Partial<React.ComponentProps<typeof AiPromptSection>> = {}) {
  return {
    settings: base,
    locale: "en" as const,
    models,
    modelsLoading: false,
    onConnect: vi.fn(async () => {}),
    onDisconnect: vi.fn(async () => {}),
    onLoadModels: vi.fn(async () => {}),
    onUpdateImmediate: vi.fn(),
    onUpdateDebounced: vi.fn(),
    ...overrides,
  };
}

describe("AiPromptSection", () => {
  it("hides the password input after connection and loads models", async () => {
    const onLoadModels = vi.fn(async () => {});
    render(<AiPromptSection {...props({ onLoadModels })} />);

    expect(screen.queryByPlaceholderText(/AIza/)).not.toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    await waitFor(() => expect(onLoadModels).toHaveBeenCalledTimes(1));
  });

  it("keeps advanced generation controls collapsed by default", () => {
    render(<AiPromptSection {...props()} />);
    expect(screen.queryByLabelText(/temperature/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/max output tokens/i)).not.toBeInTheDocument();
  });

  it("connects a candidate key explicitly instead of autosaving it", async () => {
    const onConnect = vi.fn(async () => {});
    const onUpdateDebounced = vi.fn();
    render(
      <AiPromptSection
        {...props({
          settings: { ...base, api_key_set: false },
          models: [],
          onConnect,
          onUpdateDebounced,
        })}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "AIza-test-key");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(onConnect).toHaveBeenCalledWith("AIza-test-key");
    expect(onUpdateDebounced).not.toHaveBeenCalledWith(
      expect.objectContaining({ api_key: expect.anything() }),
    );
  });

  it("debounces system prompt edits while model/language selections commit immediately", async () => {
    const onUpdateDebounced = vi.fn();
    render(<AiPromptSection {...props({ onUpdateDebounced })} />);

    const prompt = screen.getByLabelText("Instructions for AI");
    await userEvent.type(prompt, " concise");
    expect(onUpdateDebounced).toHaveBeenCalled();
  });
});
