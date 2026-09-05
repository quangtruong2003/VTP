import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsShell } from "./SettingsShell";

describe("SettingsShell", () => {
  it("uses persistent sidebar navigation and has no global save button", async () => {
    const onSectionChange = vi.fn();
    render(
      <SettingsShell
        section="general"
        onSectionChange={onSectionChange}
        status="idle"
        locale="en"
        onRetry={() => {}}
      >
        <div>General content</div>
      </SettingsShell>,
    );

    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^voice$/i }));
    expect(onSectionChange).toHaveBeenCalledWith("voice");
  });
});
