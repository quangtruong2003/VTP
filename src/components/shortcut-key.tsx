import { cn } from "@/lib/utils";

export function ShortcutKey({ label, className }: { label: string; className?: string }) {
  return (
    <kbd
      aria-label={label}
      className={cn(
        "inline-flex min-w-7 items-center justify-center rounded-md border border-border-strong bg-secondary px-2 py-1 text-xs font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
        className,
      )}
    >
      {label}
    </kbd>
  );
}
