import { describe, expect, it } from "vitest";
import { resolveUiLocale, t } from "@/lib/i18n";

describe("i18n", () => {
  it("uses explicit locale over OS locale", () => {
    expect(resolveUiLocale("vi", "en-US")).toBe("vi");
  });

  it("falls back unsupported system locale to English", () => {
    expect(resolveUiLocale("system", "ko-KR")).toBe("en");
  });

  it("never returns mixed fallback keys for core overlay copy", () => {
    expect(t("vi", "overlay.processing")).toBe("Đang xử lý…");
    expect(t("en", "overlay.processing")).toBe("Processing…");
  });
});
