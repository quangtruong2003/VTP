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
      className="overlay-surface h-screen w-screen overflow-hidden rounded-[24px] border border-zinc-800/90 bg-zinc-950/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.6)] select-none"
    >
      <div data-tauri-drag-region className="h-full w-full">
        {children}
      </div>
    </div>
  );
}
