import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "success" | "warning" | "error";

const toneClass: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  error: "border-red-400/20 bg-red-400/10 text-red-100",
};

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", toneClass[tone])}>
      {children}
    </span>
  );
}
