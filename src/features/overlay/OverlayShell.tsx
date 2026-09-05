import { useEffect, useRef, type AnimationEvent, type ReactNode } from "react";
import type { OverlayLifecycle } from "@/lib/types";

const EXIT_FALLBACK_MS = 220;

export function OverlayShell({
  children,
  lifecycle,
  onExitComplete,
  onPointerEnter,
  onPointerLeave,
}: {
  children: ReactNode;
  lifecycle: OverlayLifecycle;
  onExitComplete: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const onExitCompleteRef = useRef(onExitComplete);
  const exitCompletedRef = useRef(false);
  onExitCompleteRef.current = onExitComplete;

  useEffect(() => {
    if (lifecycle !== "exiting") {
      exitCompletedRef.current = false;
      return;
    }

    exitCompletedRef.current = false;
    const timer = window.setTimeout(() => {
      if (exitCompletedRef.current) return;
      exitCompletedRef.current = true;
      onExitCompleteRef.current();
    }, EXIT_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [lifecycle]);

  if (lifecycle === "hidden") return null;

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (
      lifecycle === "exiting" &&
      event.animationName === "overlay-exit" &&
      !exitCompletedRef.current
    ) {
      exitCompletedRef.current = true;
      onExitCompleteRef.current();
    }
  };

  return (
    <div
      data-testid="overlay-shell"
      data-lifecycle={lifecycle}
      data-tauri-drag-region
      onAnimationEnd={handleAnimationEnd}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="overlay-surface h-screen w-screen overflow-hidden rounded-[16px] border border-border bg-[color-mix(in_oklab,var(--surface-1)_96%,black)] shadow-[0_10px_28px_rgba(0,0,0,0.30),0_1px_6px_rgba(0,0,0,0.24)]"
    >
      <div data-tauri-drag-region className="h-full w-full">
        {children}
      </div>
    </div>
  );
}
