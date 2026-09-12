import type { PlatformInfo } from "@/lib/types";

export interface ShortcutCandidate {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string | null;
}

export type ShortcutValidation =
  | { ok: true }
  | { ok: false; reason: "modifier_only" | "missing_modifier" | "unsupported" };

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
const COMMON_KEYS = new Set([
  "Space",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Escape",
]);

function normalizeKey(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  if (event.code.startsWith("Key") && event.code.length === 4) {
    return event.code.slice(3).toUpperCase();
  }
  if (event.code.startsWith("Digit") && event.code.length === 6) {
    return event.code.slice(5);
  }
  if (event.code === "Space" || event.key === " ") return "Space";
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.key)) return event.key;
  if (COMMON_KEYS.has(event.key)) return event.key;
  if (event.key.length === 1 && /[a-z0-9]/i.test(event.key)) {
    return event.key.toUpperCase();
  }
  return event.key || null;
}

export function candidateFromKeyboardEvent(event: KeyboardEvent): ShortcutCandidate {
  return {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
    key: normalizeKey(event),
  };
}

export function validateCandidate(
  candidate: ShortcutCandidate,
  options: { allowUnmodified?: boolean } = {},
): ShortcutValidation {
  const hasModifier = candidate.ctrl || candidate.shift || candidate.alt || candidate.meta;
  if (!candidate.key) {
    return { ok: false, reason: "modifier_only" };
  }
  if (!hasModifier && candidate.key === "Enter") {
    return { ok: false, reason: "unsupported" };
  }
  if (!hasModifier && !options.allowUnmodified) {
    return { ok: false, reason: "missing_modifier" };
  }
  const supported =
    /^[A-Z0-9]$/.test(candidate.key) ||
    /^F(?:[1-9]|1\d|2[0-4])$/.test(candidate.key) ||
    COMMON_KEYS.has(candidate.key);
  if (!supported) {
    return { ok: false, reason: "unsupported" };
  }
  return { ok: true };
}

export function toTauriAccelerator(
  candidate: ShortcutCandidate,
  os: PlatformInfo["os"],
): string {
  const parts: string[] = [];
  if (candidate.ctrl) parts.push("Ctrl");
  if (candidate.shift) parts.push("Shift");
  if (candidate.alt) parts.push("Alt");
  if (candidate.meta) parts.push(os === "macos" ? "Cmd" : "Meta");
  if (candidate.key) parts.push(candidate.key);
  return parts.join("+");
}

export function displayShortcut(
  accelerator: string,
  os: PlatformInfo["os"],
): string[] {
  return accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "cmdorctrl" || lower === "commandorcontrol") {
        return os === "macos" ? "⌘" : "Ctrl";
      }
      if (os === "macos") {
        if (["cmd", "command", "meta", "super"].includes(lower)) return "⌘";
        if (["ctrl", "control"].includes(lower)) return "⌃";
        if (lower === "shift") return "⇧";
        if (["alt", "option"].includes(lower)) return "⌥";
      }
      if (["cmd", "command"].includes(lower)) return "Meta";
      if (lower === "control") return "Ctrl";
      if (lower === "option") return "Alt";
      return part;
    });
}
