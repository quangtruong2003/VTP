import { useEffect, useRef, useState } from "react";
import { t, type UiLocale } from "@/lib/i18n";

const BAR_PROFILE = [0.38, 0.58, 0.76, 0.92, 1, 0.94, 0.78, 0.62, 0.5, 0.36];

export function VoiceMeter({ level, locale }: { level: number; locale: UiLocale }) {
  const normalize = (value: number) => {
    const raw = Math.max(0, Math.min(1, value / 255));
    return raw === 0 ? 0 : Math.min(1, Math.pow(raw, 0.78) * 1.08);
  };
  const targetRef = useRef(normalize(level));
  const currentRef = useRef(targetRef.current);
  const [amplitude, setAmplitude] = useState(targetRef.current);

  useEffect(() => {
    targetRef.current = normalize(level);
  }, [level]);

  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setAmplitude(targetRef.current);
      return;
    }
    let frame = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const current = currentRef.current;
      const target = targetRef.current;
      const next =
        target > current
          ? current + (target - current) * 0.64
          : current + (target - current) * 0.2;
      currentRef.current = Math.abs(next - target) < 0.002 ? target : next;
      setAmplitude(currentRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      role="status"
      aria-label={`${t(locale, "overlay.voiceLevel")} ${Math.round(amplitude * 100)}%`}
      className="flex h-9 items-center gap-1"
    >
      {BAR_PROFILE.map((profile, index) => {
        const height = 4 + Math.round(profile * amplitude * 31);
        return (
          <span
            aria-hidden="true"
            key={index}
            className="w-1 rounded-full bg-primary/85"
            style={{ height, transition: "height var(--motion-instant) linear" }}
          />
        );
      })}
    </div>
  );
}
