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
  shortcut_mode: "toggle",
  process_shortcut: "Enter",
  cancel_shortcut: "Escape",
  copy_to_clipboard: true,
  paste_automatically: true,
  device_name: null,
  show_history: true,
  ui_locale: "en",
  prompt_profile_id: "natural",
  prompt_profiles: [
    { id: "raw", name: "Raw", prompt: "raw prompt" },
    { id: "natural", name: "Natural", prompt: "natural prompt" },
    { id: "email", name: "Email", prompt: "email prompt" },
    { id: "summary", name: "Summary", prompt: "summary prompt" },
    { id: "code", name: "Code", prompt: "code prompt" },
  ],
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

  it("shows a recoverable notice when the model list cannot load", () => {
    render(<AiPromptSection {...props({ modelsError: true })} />);

    expect(screen.getByText("Couldn't load the model list. Your current model is still available.")).toBeInTheDocument();
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

  it("prevents duplicate key connections while the request is pending", async () => {
    let resolveConnect!: () => void;
    const onConnect = vi.fn(() => new Promise<void>((resolve) => {
      resolveConnect = resolve;
    }));
    render(
      <AiPromptSection
        {...props({
          settings: { ...base, api_key_set: false },
          models: [],
          onConnect,
        })}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/AIza/), "AIza-test-key");
    const connectButton = screen.getByRole("button", { name: "Connect" });
    await userEvent.click(connectButton);

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(connectButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connecting…" })).toHaveAttribute("aria-busy", "true");

    resolveConnect();
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
  });

  it("prevents duplicate disconnect requests while the request is pending", async () => {
    let resolveDisconnect!: () => void;
    const onDisconnect = vi.fn(() => new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    }));
    render(<AiPromptSection {...props({ onDisconnect })} />);

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    await userEvent.click(disconnectButton);
    await userEvent.click(disconnectButton);

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(disconnectButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disconnecting…" })).toHaveAttribute("aria-busy", "true");

    resolveDisconnect();
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument());
  });

  it("debounces system prompt edits while model/language selections commit immediately", async () => {
    const onUpdateDebounced = vi.fn();
    render(<AiPromptSection {...props({ onUpdateDebounced })} />);

    const prompt = screen.getByLabelText("Instructions for AI");
    await userEvent.type(prompt, " concise");
    expect(onUpdateDebounced).toHaveBeenCalled();
  });

  it("renders prompt profile presets and saves the selected profile", async () => {
    const onUpdateImmediate = vi.fn();
    render(<AiPromptSection {...props({ onUpdateImmediate })} />);

    expect(screen.getByRole("option", { name: "Raw" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Natural" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Code" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Prompt profile"), "email");
    expect(onUpdateImmediate).toHaveBeenCalledWith({ prompt_profile_id: "email" });
  });

  it("localizes built-in profile names without changing their stable ids", () => {
    render(<AiPromptSection {...props({ locale: "vi" })} />);

    expect(screen.getByRole("option", { name: "Tự nhiên" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tóm tắt" })).toHaveValue("summary");
  });

  it("explains that system instructions remain effective with a selected profile", () => {
    render(
      <AiPromptSection
        {...props({ settings: { ...base, system_prompt: "Use a warm tone." } })}
      />,
    );

    expect(screen.getByLabelText("Instructions for AI")).toHaveValue("Use a warm tone.");
    expect(screen.getByText(/combined with the selected prompt profile/i)).toBeInTheDocument();
  });

  it("keeps legacy custom instructions while restoring missing preset data", () => {
    render(
      <AiPromptSection
        {...props({
          settings: { ...base, prompt_profile_id: "", prompt_profiles: [] },
        })}
      />,
    );

    expect(screen.getByRole("option", { name: "Custom instructions" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Natural" })).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt profile")).toHaveValue("");
  });

  it("adds a minimal custom prompt profile", async () => {
    const onUpdateImmediate = vi.fn();
    render(<AiPromptSection {...props({ onUpdateImmediate })} />);

    await userEvent.type(screen.getByLabelText("Custom profile name"), "Support");
    await userEvent.type(screen.getByLabelText("Custom profile prompt"), "Write a support reply.");
    await userEvent.click(screen.getByRole("button", { name: "Add custom profile" }));

    expect(onUpdateImmediate).toHaveBeenCalledWith(expect.objectContaining({
      prompt_profile_id: expect.stringMatching(/^custom-/),
      prompt_profiles: expect.arrayContaining([
        expect.objectContaining({ name: "Support", prompt: "Write a support reply." }),
      ]),
    }));
  });
});
