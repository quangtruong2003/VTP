import { describe, expect, it } from "vitest";
import {
  candidateFromKeyboardEvent,
  displayShortcut,
  toTauriAccelerator,
  validateCandidate,
} from "./shortcut";

describe("shortcut capture helpers", () => {
  it("canonicalizes Ctrl+Shift+Space for Tauri", () => {
    expect(
      toTauriAccelerator(
        { ctrl: true, shift: true, alt: false, meta: false, key: "Space" },
        "windows",
      ),
    ).toBe("Ctrl+Shift+Space");
  });

  it("rejects modifier-only and missing-modifier input for the record shortcut", () => {
    expect(
      validateCandidate({ ctrl: true, shift: false, alt: false, meta: false, key: null }),
    ).toEqual({ ok: false, reason: "modifier_only" });
    expect(
      validateCandidate({ ctrl: false, shift: false, alt: false, meta: false, key: "K" }),
    ).toEqual({ ok: false, reason: "missing_modifier" });
  });

  it("rejects unmodified Enter but allows Escape for session-only action shortcuts", () => {
    expect(
      validateCandidate(
        { ctrl: false, shift: false, alt: false, meta: false, key: "Enter" },
        { allowUnmodified: true },
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
    expect(
      validateCandidate(
        { ctrl: false, shift: false, alt: false, meta: false, key: "Escape" },
        { allowUnmodified: true },
      ),
    ).toEqual({ ok: true });
  });

  it("normalizes character and common non-character keys", () => {
    const letter = candidateFromKeyboardEvent(
      new KeyboardEvent("keydown", { code: "KeyV", key: "v", ctrlKey: true }),
    );
    const arrow = candidateFromKeyboardEvent(
      new KeyboardEvent("keydown", { code: "ArrowUp", key: "ArrowUp", altKey: true }),
    );
    expect(letter.key).toBe("V");
    expect(arrow.key).toBe("ArrowUp");
    expect(toTauriAccelerator(arrow, "windows")).toBe("Alt+ArrowUp");
  });

  it("renders macOS Meta as the native command keycap", () => {
    expect(displayShortcut("Cmd+Shift+Space", "macos")).toEqual(["⌘", "⇧", "Space"]);
    expect(displayShortcut("CmdOrCtrl+Shift+Space", "windows")).toEqual([
      "Ctrl",
      "Shift",
      "Space",
    ]);
  });
});
