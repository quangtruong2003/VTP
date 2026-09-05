import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type NoticeTone = "info" | "success" | "warning" | "error";

const toneClass: Record<NoticeTone, string> = {
  info: "border-zinc-800 bg-zinc-900/60 text-zinc-300",
  success: "border-emerald-400/20 bg-emerald-400/8 text-emerald-100",
  warning: "border-amber-400/20 bg-amber-400/8 text-amber-100",
  error: "border-red-400/20 bg-red-400/8 text-red-100",
};

export function InlineNotice({ children, tone = "info", className }: { children: ReactNode; tone?: NoticeTone; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-xs leading-5", toneClass[tone], className)}>
      {children}
    </div>
  );
}
