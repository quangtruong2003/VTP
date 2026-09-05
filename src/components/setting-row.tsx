import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex min-h-16 items-center justify-between gap-6 py-3", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
