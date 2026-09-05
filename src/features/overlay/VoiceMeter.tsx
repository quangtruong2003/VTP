import { memo, useCallback, useEffect, useRef } from "react";
import { t, type UiLocale } from "@/lib/i18n";

const BAR_PROFILE = [0.38, 0.58, 0.76, 0.92, 1, 0.94, 0.78, 0.62, 0.5, 0.36];
const ATTACK = 0.64;
const RELEASE = 0.2;
const SETTLED_DELTA = 0.002;

function normalize(value: number) {
  const raw = Math.max(0, Math.min(1, value / 255));
  return raw === 0 ? 0 : Math.min(1, Math.pow(raw, 0.78) * 1.08);
}

function VoiceMeterComponent({ level, locale }: { level: number; locale: UiLocale }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const frameRef = useRef<number | null>(null);
  const currentRef = useRef(normalize(level));
  const targetRef = useRef(currentRef.current);

  const paint = useCallback((amplitude: number) => {
    const percentage = Math.round(amplitude * 100);
    const container = containerRef.current;
    if (container) {
      container.dataset.level = String(percentage);
      container.setAttribute("aria-valuenow", String(percentage));
      container.setAttribute(
        "aria-valuetext",
        `${t(locale, "overlay.voiceLevel")} ${percentage}%`,
      );
    }
    barsRef.current.forEach((bar, index) => {
      if (bar) bar.style.transform = `scaleY(${0.12 + BAR_PROFILE[index] * amplitude * 0.88})`;
    });
  }, [locale]);

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => {
    targetRef.current = normalize(level);
    const reducedMotion = typeof matchMedia === "function"
      && matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || typeof requestAnimationFrame !== "function") {
      stopFrame();
      currentRef.current = targetRef.current;
      paint(currentRef.current);
      return;
    }

    if (frameRef.current !== null || Math.abs(targetRef.current - currentRef.current) < SETTLED_DELTA) {
      paint(currentRef.current);
      return;
    }

    const tick = () => {
      const current = currentRef.current;
      const target = targetRef.current;
      const next = current + (target - current) * (target > current ? ATTACK : RELEASE);
      currentRef.current = Math.abs(next - target) < SETTLED_DELTA ? target : next;
      paint(currentRef.current);

      if (currentRef.current === targetRef.current) {
        frameRef.current = null;
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [level, paint, stopFrame]);

  useEffect(() => {
    paint(currentRef.current);
    return stopFrame;
  }, [paint, stopFrame]);

  return (
    <div
      ref={containerRef}
      role="meter"
      aria-label={t(locale, "overlay.voiceLevel")}
      aria-valuemin={0}
      aria-valuemax={100}
      data-level={Math.round(currentRef.current * 100)}
      aria-valuenow={Math.round(currentRef.current * 100)}
      aria-valuetext={`${t(locale, "overlay.voiceLevel")} ${Math.round(currentRef.current * 100)}%`}
      className="flex h-7 items-center gap-1"
    >
      {BAR_PROFILE.map((_profile, index) => (
        <span
          aria-hidden="true"
          data-meter-bar
          key={index}
          ref={(element) => {
            barsRef.current[index] = element;
          }}
          className="h-[20px] w-1 origin-center rounded-full bg-zinc-100/90 will-change-transform"
          style={{ transform: `scaleY(${0.12 + BAR_PROFILE[index] * currentRef.current * 0.88})` }}
        />
      ))}
    </div>
  );
}

export const VoiceMeter = memo(VoiceMeterComponent);
