import { describe, expect, it } from "vitest";
import { settingsLoadErrorMessage } from "./useSettingsStore";

describe("settingsLoadErrorMessage", () => {
  it("preserves the typed native error detail", () => {
    expect(
      settingsLoadErrorMessage({
        code: "settings_failed",
        detail: "settings file is unavailable",
      }),
    ).toBe("settings file is unavailable");
  });

  it("falls back to standard Error messages", () => {
    expect(settingsLoadErrorMessage(new Error("settings failed"))).toBe("settings failed");
  });
});
