import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceMeter } from "./VoiceMeter";

function installAnimationFrame() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
    frames.delete(id);
  }));

  return {
    runFrame(time = 16) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(time));
    },
    pendingCount() {
      return frames.size;
    },
  };
}

describe("VoiceMeter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the initial meter scale before effects run", () => {
    const { container } = render(<VoiceMeter level={0} locale="en" />);
    const meter = container.firstElementChild as HTMLElement;
    const firstBar = container.querySelector<HTMLElement>("[data-meter-bar]");

    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(meter).toHaveAttribute("aria-valuetext", expect.stringContaining("0%"));
    expect(firstBar?.style.transform).toBe("scaleY(0.12)");
  });
  it("updates bar transforms outside React renders and sleeps once settled", () => {
    const animation = installAnimationFrame();
    const { container, rerender } = render(<VoiceMeter level={0} locale="en" />);
    const meter = container.firstElementChild as HTMLElement;
    const bars = [...container.querySelectorAll<HTMLElement>("[data-meter-bar]")];
    const firstBar = bars[0];

    expect(animation.pendingCount()).toBe(0);

    rerender(<VoiceMeter level={255} locale="en" />);
    expect(animation.pendingCount()).toBe(1);

    animation.runFrame();
    expect(meter.dataset.level).not.toBe("0");
    expect(firstBar.style.transform).not.toBe("scaleY(0)");

    for (let frame = 0; frame < 120 && animation.pendingCount() > 0; frame += 1) {
      animation.runFrame((frame + 2) * 16);
    }

    expect(animation.pendingCount()).toBe(0);
  });

  it("disables interpolation when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const animation = installAnimationFrame();
    const { container, rerender } = render(<VoiceMeter level={0} locale="en" />);
    const meter = container.firstElementChild as HTMLElement;

    rerender(<VoiceMeter level={255} locale="en" />);

    expect(animation.pendingCount()).toBe(0);
    expect(meter.dataset.level).toBe("100");
  });
});

