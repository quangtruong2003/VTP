import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Copy,
  CornerDownLeft,
  History,
  Mic,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { resolveUiLocale, t, type UiLocale } from "@/lib/i18n";
import { settingsApi } from "@/lib/settings";
import { RUST_EVENTS } from "@/lib/types";
import type { FrontendError, HistoryEntry } from "@/lib/types";

function toFrontendError(value: unknown): FrontendError {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Partial<FrontendError>;
    if (typeof candidate.code === "string" && typeof candidate.recoverable === "boolean") {
      return candidate as FrontendError;
    }
  }

  return {
    code: "unknown",
    recoverable: true,
    detail: value instanceof Error ? value.message : String(value),
  };
}

function relativeTime(value: string, locale: UiLocale) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);
  const formatter = RELATIVE_TIME_FORMATTERS[locale];
  if (absolute < 60) return formatter.format(diffSeconds, "second");
  const minutes = Math.round(diffSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

const RELATIVE_TIME_FORMATTERS: Record<UiLocale, Intl.RelativeTimeFormat> = {
  en: new Intl.RelativeTimeFormat("en", { numeric: "auto" }),
  vi: new Intl.RelativeTimeFormat("vi", { numeric: "auto" }),
};

function durationLabel(durationMs: number) {
  if (durationMs < 60_000) return `${Math.max(0.1, durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function HistoryApp() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<FrontendError | null>(null);
  const [locale, setLocale] = useState<UiLocale>("vi");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearError, setClearError] = useState<FrontendError | null>(null);
  const [actionError, setActionError] = useState<FrontendError | null>(null);
  const [inserting, setInserting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const clearTriggerRef = useRef<HTMLButtonElement>(null);
  const clearDialogRef = useRef<HTMLDivElement>(null);
  const clearDialogWasOpenRef = useRef(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loadRequestRef = useRef(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);
  const [retryingLoad, setRetryingLoad] = useState(false);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoadError(null);
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const list = await settingsApi.historyList();
      if (loadRequestRef.current !== requestId) return;
      setEntries(list);
      setLoading(false);
      setLoadError(null);
      hasLoadedRef.current = true;
    } catch (error) {
      if (loadRequestRef.current === requestId) {
        setLoading(false);
        setLoadError(toFrontendError(error));
      }
    }
  }, []);

  const retryLoad = useCallback(async () => {
    if (retryingLoad) return;
    setRetryingLoad(true);
    try {
      await loadData();
    } finally {
      setRetryingLoad(false);
    }
  }, [loadData, retryingLoad]);

  useEffect(() => {
    let disposed = false;
    searchInputRef.current?.focus();

    const unlistenChanged = listen(RUST_EVENTS.historyChanged, () => {
      void loadData();
    }).catch(() => () => {});
    const unlistenOpened = listen("history://opened", () => {
      void loadData();
      searchInputRef.current?.focus();
    }).catch(() => () => {});

    void settingsApi.get()
      .then((pubSettings) => {
        if (!disposed) {
          setLocale(resolveUiLocale(pubSettings.ui_locale, navigator.language));
        }
      })
      .catch(() => {});

    void Promise.all([unlistenChanged, unlistenOpened]).then(() => {
      if (!disposed) void loadData();
    });

    return () => {
      disposed = true;
      loadRequestRef.current += 1;
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
      unlistenChanged.then((u) => u());
      unlistenOpened.then((u) => u());
    };
  }, [loadData]);

  useEffect(() => {
    if (showClearConfirm) {
      clearDialogWasOpenRef.current = true;
      clearCancelRef.current?.focus();
    } else if (clearDialogWasOpenRef.current) {
      clearDialogWasOpenRef.current = false;
      clearTriggerRef.current?.focus();
    }
  }, [showClearConfirm]);

  const trapClearDialogFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const buttons = Array.from(
      clearDialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;

    return entries.filter(
      (e) =>
        e.response_text.toLowerCase().includes(q) ||
        (e.transcript_hint && e.transcript_hint.toLowerCase().includes(q)) ||
        e.model.toLowerCase().includes(q),
    );
  }, [entries, searchQuery]);

  // Keep selectedId valid
  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !filteredEntries.some((e) => e.id === selectedId)) {
      setSelectedId(filteredEntries[0].id);
    }
  }, [filteredEntries, selectedId]);

  const handleClose = useCallback(() => {
    settingsApi.closeHistory().catch(() => {});
  }, []);

  const handleInsert = useCallback(
    async (text: string) => {
      if (inserting) return;
      setInserting(true);
      try {
        await settingsApi.historyInsert(text);
      } catch {
        try {
          await settingsApi.copyText(text);
          handleClose();
        } catch (error) {
          setActionError(toFrontendError(error));
        }
      } finally {
        setInserting(false);
      }
    },
    [handleClose, inserting],
  );

  const handleCopy = useCallback(async (entry: HistoryEntry) => {
    if (copying) return;
    setActionError(null);
    setCopying(true);
    try {
      await settingsApi.historyCopy(entry.id);
      setCopiedId(entry.id);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedId((curr) => (curr === entry.id ? null : curr));
      }, 1500);
    } catch (error) {
      setActionError(toFrontendError(error));
    } finally {
      setCopying(false);
    }
  }, [copying]);

  const handleDelete = useCallback(async (id: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (deleting) return;
    setActionError(null);
    setDeleting(true);
    try {
      await settingsApi.historyDelete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (error) {
      setActionError(toFrontendError(error));
    } finally {
      setDeleting(false);
    }
  }, [deleting]);

  const handleClearAll = useCallback(async () => {
    if (clearing) return;
    setClearError(null);
    setClearing(true);
    try {
      await settingsApi.historyClear();
      setEntries([]);
      setShowClearConfirm(false);
    } catch (error) {
      setClearError(toFrontendError(error));
    } finally {
      setClearing(false);
    }
  }, [clearing]);

  // Keyboard navigation like Windows Clipboard (Win + V)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showClearConfirm) {
          if (clearing) return;
          setShowClearConfirm(false);
          return;
        }
        if (searchQuery) {
          setSearchQuery("");
          return;
        }
        handleClose();
        return;
      }

      // If clear confirm modal is open, ignore navigation
      if (showClearConfirm) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredEntries.length === 0) return;
        const currentIndex = filteredEntries.findIndex((item) => item.id === selectedId);
        const nextIndex = currentIndex < filteredEntries.length - 1 ? currentIndex + 1 : 0;
        const nextId = filteredEntries[nextIndex].id;
        setSelectedId(nextId);
        cardRefs.current.get(nextId)?.scrollIntoView({ block: "nearest", behavior: "auto" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredEntries.length === 0) return;
        const currentIndex = filteredEntries.findIndex((item) => item.id === selectedId);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredEntries.length - 1;
        const prevId = filteredEntries[prevIndex].id;
        setSelectedId(prevId);
        cardRefs.current.get(prevId)?.scrollIntoView({ block: "nearest", behavior: "auto" });
      } else if (e.key === "Enter") {
        // If focusing search input and pressing Enter without Alt/Ctrl
        const activeEl = document.activeElement;
        const isTyping = activeEl?.tagName === "INPUT" || activeEl?.tagName === "TEXTAREA";
        if (isTyping && e.target === searchInputRef.current) {
          // If search has matches, insert selected
          const item = filteredEntries.find((e) => e.id === selectedId);
          if (item) {
            e.preventDefault();
            handleInsert(item.response_text);
          }
        } else if (
          activeEl?.tagName === "BUTTON"
          || activeEl?.tagName === "A"
          || activeEl?.tagName === "SELECT"
        ) {
          return;
        } else {
          const item = filteredEntries.find((e) => e.id === selectedId);
          if (item) {
            e.preventDefault();
            handleInsert(item.response_text);
          }
        }
      } else if (e.key === "Delete") {
        const activeTag = document.activeElement?.tagName;
        const isInteractive = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "BUTTON" || activeTag === "A" || activeTag === "SELECT";
        if (!isInteractive && selectedId) {
          e.preventDefault();
          handleDelete(selectedId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const activeTag = document.activeElement?.tagName;
        const isInteractive = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "BUTTON" || activeTag === "A" || activeTag === "SELECT";
        if (!isInteractive && selectedId) {
          const item = filteredEntries.find((e) => e.id === selectedId);
          if (item) {
            e.preventDefault();
            handleCopy(item);
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    filteredEntries,
    selectedId,
    searchQuery,
    showClearConfirm,
    handleClose,
    handleInsert,
    handleCopy,
    handleDelete,
    clearing,
  ]);

  return (
    <div className="h-screen w-screen p-2 box-border flex flex-col font-sans select-none overflow-hidden bg-transparent">
      {/* Windows 11 Acrylic style card container with shadcn zinc theme */}
      <div className="relative h-full w-full rounded-2xl border border-zinc-800/80 bg-zinc-950/95 shadow-2xl flex flex-col overflow-hidden text-zinc-100 ring-1 ring-white/10">
        {/* Header Bar with data-tauri-drag-region */}
        <div
          data-tauri-drag-region
          className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/40 cursor-move select-none"
        >
          <div className="flex items-center gap-2 pointer-events-none">
            <div className="flex items-center justify-center size-7 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700/60">
              <History className="size-4" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
                {t(locale, "historyWindow.title")}
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/40 font-medium">
                {entries.length}{" "}
                {entries.length === 1
                  ? t(locale, "historyWindow.item")
                  : t(locale, "historyWindow.items")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <button
                ref={clearTriggerRef}
                type="button"
                aria-label={t(locale, "historyWindow.clearAll")}
                title={t(locale, "historyWindow.clearAll")}
                onClick={() => {
                  setClearError(null);
                  setShowClearConfirm(true);
                }}
                className="flex items-center justify-center size-7 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label={t(locale, "historyWindow.cancel")}
              title="Esc"
              onClick={handleClose}
              className="flex items-center justify-center size-7 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800/60 bg-zinc-950/40 space-y-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 size-3.5 text-zinc-500 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(locale, "historyWindow.searchPlaceholder")}
              className="w-full h-8 pl-8 pr-7 text-xs rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label={t(locale, "historyWindow.clearSearch")}
                title={t(locale, "historyWindow.clearSearch")}
                onClick={() => setSearchQuery("")}
                className="absolute right-2 rounded text-zinc-500 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {actionError ? (
            <div
              role="alert"
              data-error-code={actionError.code}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-200"
            >
              <span className="font-medium">{t(locale, "historyWindow.actionFailed")}</span>
              {actionError.detail ? <span className="ml-1 break-words text-red-200/80">{actionError.detail}</span> : null}
            </div>
          ) : null}

          {loadError && entries.length > 0 ? (
            <div
              role="alert"
              data-error-code={loadError.code}
              className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-200"
            >
              <span className="min-w-0 break-words">
                <span className="font-medium">{t(locale, "historyWindow.loadFailed")}</span>
                {loadError.detail ? <span className="ml-1 text-red-200/80">{loadError.detail}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => void retryLoad()}
                disabled={retryingLoad}
                aria-busy={retryingLoad}
                className="shrink-0 rounded px-2 py-1 font-medium text-red-100 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-300 disabled:opacity-60"
              >
                {t(locale, "historyWindow.retry")}
              </button>
            </div>
          ) : null}

        </div>

        {/* Card List Area */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 overscroll-contain">
          {loading ? (
            <div
              role="status"
              aria-label={t(locale, "historyWindow.loading")}
              className="space-y-2.5"
            >
              {["h-24", "h-28", "h-20"].map((height) => (
                <div
                  key={height}
                  className={`animate-pulse rounded-xl border border-zinc-800/80 bg-zinc-900/60 ${height}`}
                />
              ))}
            </div>
          ) : loadError && entries.length === 0 ? (
            <div
              role="alert"
              data-error-code={loadError.code}
              className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500"
            >
              <div className="size-12 rounded-full border border-red-500/30 flex items-center justify-center mb-3 bg-red-500/10">
                <History className="size-6 text-red-300/80" />
              </div>
              <h2 className="text-sm font-medium text-zinc-200">
                {t(locale, "historyWindow.loadFailed")}
              </h2>
              {loadError.detail ? (
                <p className="mt-1 text-xs leading-5 max-w-[260px] break-words text-zinc-500">
                  {loadError.detail}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void retryLoad()}
                disabled={retryingLoad}
                aria-busy={retryingLoad}
                className="mt-3 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:opacity-60"
              >
                {t(locale, "historyWindow.retry")}
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <div className="size-12 rounded-full border border-dashed border-zinc-800 flex items-center justify-center mb-3 bg-zinc-900/30">
                <History className="size-6 text-zinc-600" />
              </div>
              <h2 className="text-sm font-medium text-zinc-200">
                {t(locale, "historyWindow.emptyTitle")}
              </h2>
              <p className="mt-1 text-xs leading-5 max-w-[260px] text-zinc-500">
                {t(locale, "historyWindow.emptyDesc")}
              </p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <div className="size-10 rounded-full border border-zinc-800 flex items-center justify-center mb-2 bg-zinc-900/30">
                <Search className="size-5 text-zinc-600" />
              </div>
              <h2 className="text-xs font-medium text-zinc-200">
                {t(locale, "historyWindow.noResultsTitle")}
              </h2>
              <p className="mt-1 text-[11px] text-zinc-500">
                {t(locale, "historyWindow.noResultsDesc")}
              </p>
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const isSelected = entry.id === selectedId;
              const isCopied = entry.id === copiedId;

              return (
                <div
                  key={entry.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(entry.id, el);
                    else cardRefs.current.delete(entry.id);
                  }}
                  onClick={() => handleInsert(entry.response_text)}
                  onFocus={() => setSelectedId(entry.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      handleInsert(entry.response_text);
                    }
                  }}
                  role="button"
                  tabIndex={isSelected ? 0 : -1}
                  aria-pressed={isSelected}
                  aria-busy={inserting}
                  className={`group relative p-3 rounded-xl border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 ${
                    isSelected
                      ? "border-zinc-500 bg-zinc-800/70 shadow-md ring-1 ring-zinc-500/50"
                      : "border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-800/40 hover:border-zinc-700"
                  }`}
                >
                  {/* Top Metadata row */}
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-zinc-200">
                        {relativeTime(entry.created_at, locale)}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5 text-zinc-400">
                        <Clock3 className="size-3" />
                        {durationLabel(entry.duration_ms)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-400 border border-zinc-700/50">
                        {entry.model}
                      </span>
                    </div>
                  </div>

                  {/* Transcript hint (what was spoken) */}
                  {entry.transcript_hint && (
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-300 bg-zinc-800/60 px-2 py-1 rounded-md mb-2 border border-zinc-700/40">
                      <Mic className="size-3 shrink-0 text-zinc-400" />
                      <span className="italic whitespace-pre-wrap break-words">
                        "{entry.transcript_hint}"
                      </span>
                    </div>
                  )}

                  {/* Generated response text */}
                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap line-clamp-4 font-normal select-text">
                    {entry.response_text}
                  </p>

                  {/* Action buttons (hover / focus bar) */}
                  <div className="mt-2.5 pt-2 border-t border-zinc-800/60 flex items-center justify-between opacity-80 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/60 font-medium">
                        <CornerDownLeft className="size-3 text-zinc-400" />
                        {t(locale, "historyWindow.insert")}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={t(locale, "historyWindow.copy")}
                        title={t(locale, "historyWindow.copy")}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(entry);
                        }}
                        disabled={copying}
                        aria-busy={copying}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                      >
                        {isCopied ? (
                          <>
                            <Check className="size-3 text-zinc-200" />
                            <span className="text-zinc-200 font-semibold">
                              {t(locale, "historyWindow.copied")}
                            </span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            <span>{t(locale, "historyWindow.copy")}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        aria-label={t(locale, "historyWindow.delete")}
                        title={t(locale, "historyWindow.delete")}
                        onClick={(e) => handleDelete(entry.id, e)}
                        disabled={deleting}
                        aria-busy={deleting}
                        className="p-1 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Keyboard hints footer */}
        <div className="px-3 py-1.5 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between text-[10px] text-zinc-400 select-none">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">↑↓</kbd> {t(locale, "historyWindow.selectHint")}
            </span>
            <span>·</span>
            <span>
              <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">Enter</kbd> {t(locale, "historyWindow.insert")}
            </span>
            <span>·</span>
            <span>
              <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">Ctrl+C</kbd> {t(locale, "historyWindow.copy")}
            </span>
          </div>
          <div>
            <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">Esc</kbd> {t(locale, "historyWindow.closeHint")}
          </div>
        </div>

        {/* Clear All Confirmation Modal */}
        {showClearConfirm && (
          <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div ref={clearDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="history-clear-title" aria-describedby="history-clear-description" onKeyDown={trapClearDialogFocus} className="w-full max-w-[340px] rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
              <h3 className="text-sm font-semibold text-zinc-100">
                <span id="history-clear-title">
                {t(locale, "historyWindow.clearConfirmTitle")}
                </span>
              </h3>
              <p id="history-clear-description" className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                {t(locale, "historyWindow.clearConfirmDesc")}
              </p>
              {clearError ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  data-error-code={clearError.code}
                  className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-200"
                >
                  <div className="font-medium">{t(locale, "historyWindow.clearFailed")}</div>
                  {clearError.detail ? <div className="mt-1 break-words text-red-200/80">{clearError.detail}</div> : null}
                </div>
              ) : null}
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  ref={clearCancelRef}
                  type="button"
                  onClick={() => {
                    setClearError(null);
                    setShowClearConfirm(false);
                  }}
                  disabled={clearing}
                  aria-busy={clearing}
                  className="px-3 py-1 rounded-md text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                >
                  {t(locale, "historyWindow.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={clearing}
                  aria-busy={clearing}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                >
                  {t(locale, "historyWindow.clearConfirmAction")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
