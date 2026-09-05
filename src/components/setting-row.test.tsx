import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingRow } from "@/components/setting-row";

describe("SettingRow", () => {
  it("exposes its visible label and description", () => {
    render(
      <SettingRow label="Microphone" description="Choose the input device">
        <button type="button">Control</button>
      </SettingRow>,
    );

    expect(screen.getByText("Microphone")).toBeVisible();
    expect(screen.getByText("Choose the input device")).toBeVisible();
    expect(screen.getByRole("button", { name: "Control" })).toBeVisible();
  });
});
