import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, description, children, className }: SectionCardProps) {
  return (
    <section className={cn("rounded-[var(--radius-lg)] border border-border bg-card/70 px-4 py-3", className)}>
      {title ? <h2 className="text-xs font-semibold text-foreground">{title}</h2> : null}
      {description ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p> : null}
      <div className={cn(title || description ? "mt-2.5" : undefined)}>{children}</div>
    </section>
  );
}
