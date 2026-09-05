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
    <section className={cn("rounded-[var(--radius-lg)] border border-border bg-card/70 px-5 py-4", className)}>
      {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
      {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      <div className={cn(title || description ? "mt-3" : undefined)}>{children}</div>
    </section>
  );
}
