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
import type { HistoryEntry } from "@/lib/types";

function relativeTime(value: string, locale: UiLocale) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absolute < 60) return formatter.format(diffSeconds, "second");
  const minutes = Math.round(diffSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function durationLabel(durationMs: number) {
  if (durationMs < 60_000) return `${Math.max(0.1, durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function HistoryApp() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [locale, setLocale] = useState<UiLocale>("vi");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "success" | "error">("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadData = useCallback(async () => {
    try {
      const [list, pubSettings, platInfo] = await Promise.all([
        settingsApi.historyList(),
        settingsApi.get().catch(() => null),
        settingsApi.platformInfo().catch(() => null),
      ]);
      setEntries(list);
      if (pubSettings) {
        const os = platInfo?.os || navigator.language;
        setLocale(resolveUiLocale(pubSettings.ui_locale, os));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadData();

    const unlistenChanged = listen("history://changed", () => {
      loadData();
    });
    const unlistenOpened = listen("history://opened", () => {
      loadData();
      searchInputRef.current?.focus();
    });

    return () => {
      unlistenChanged.then((u) => u());
      unlistenOpened.then((u) => u());
    };
  }, [loadData]);

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (filter === "success") {
      result = result.filter((e) => e.status !== "error");
    } else if (filter === "error") {
      result = result.filter((e) => e.status === "error");
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return result;

    return result.filter(
      (e) =>
        e.response_text.toLowerCase().includes(q) ||
        (e.transcript_hint && e.transcript_hint.toLowerCase().includes(q)) ||
        e.model.toLowerCase().includes(q),
    );
  }, [entries, filter, searchQuery]);

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
      try {
        await settingsApi.historyInsert(text);
      } catch {
        // Fallback to copy if insertion fails
        await settingsApi.copyText(text).catch(() => {});
        handleClose();
      }
    },
    [handleClose],
  );

  const handleCopy = useCallback(async (entry: HistoryEntry) => {
    try {
      await settingsApi.historyCopy(entry.id);
      setCopiedId(entry.id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === entry.id ? null : curr));
      }, 1500);
    } catch {
      // ignore
    }
  }, []);

  const handleDelete = useCallback(async (id: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    try {
      await settingsApi.historyDelete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // ignore
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    try {
      await settingsApi.historyClear();
      setEntries([]);
      setShowClearConfirm(false);
    } catch {
      // ignore
    }
  }, []);

  // Keyboard navigation like Windows Clipboard (Win + V)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showClearConfirm) {
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
        cardRefs.current.get(nextId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredEntries.length === 0) return;
        const currentIndex = filteredEntries.findIndex((item) => item.id === selectedId);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredEntries.length - 1;
        const prevId = filteredEntries[prevIndex].id;
        setSelectedId(prevId);
        cardRefs.current.get(prevId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
        } else {
          const item = filteredEntries.find((e) => e.id === selectedId);
          if (item) {
            e.preventDefault();
            handleInsert(item.response_text);
          }
        }
      } else if (e.key === "Delete") {
        const isTyping = document.activeElement?.tagName === "INPUT";
        if (!isTyping && selectedId) {
          e.preventDefault();
          handleDelete(selectedId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const isTyping = document.activeElement?.tagName === "INPUT";
        if (!isTyping && selectedId) {
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
  ]);

  return (
    <div className="h-screen w-screen p-2 box-border flex flex-col font-sans select-none overflow-hidden bg-transparent">
      {/* Windows 11 Acrylic style card container with shadcn zinc theme */}
      <div className="relative h-full w-full rounded-2xl border border-zinc-800/80 bg-zinc-950/95 backdrop-blur-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 ring-1 ring-white/10">
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
                type="button"
                aria-label={t(locale, "historyWindow.clearAll")}
                title={t(locale, "historyWindow.clearAll")}
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center justify-center size-7 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label={t(locale, "historyWindow.cancel")}
              title="Esc"
              onClick={handleClose}
              className="flex items-center justify-center size-7 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800/60 bg-zinc-950/40 space-y-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 size-3.5 text-zinc-500 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(locale, "historyWindow.searchPlaceholder")}
              className="w-full h-8 pl-8 pr-7 text-xs rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-zinc-500 hover:text-zinc-200"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filter Pills in shadcn monochrome style */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                filter === "all"
                  ? "bg-zinc-100 text-zinc-950 font-semibold shadow-xs"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
              }`}
            >
              {t(locale, "historyWindow.filterAll")}
            </button>
            <button
              type="button"
              onClick={() => setFilter("success")}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                filter === "success"
                  ? "bg-zinc-100 text-zinc-950 font-semibold shadow-xs"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
              }`}
            >
              {t(locale, "historyWindow.filterSuccess")}
            </button>
            {entries.some((e) => e.status === "error") && (
              <button
                type="button"
                onClick={() => setFilter("error")}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                  filter === "error"
                    ? "bg-zinc-100 text-zinc-950 font-semibold shadow-xs"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
                }`}
              >
                {t(locale, "historyWindow.filterError")}
              </button>
            )}
          </div>
        </div>

        {/* Card List Area */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 overscroll-contain">
          {entries.length === 0 ? (
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
                  className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
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
                      {entry.status === "error" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-medium">
                          Error
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Transcript hint (what was spoken) */}
                  {entry.transcript_hint && (
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-300 bg-zinc-800/60 px-2 py-1 rounded-md mb-2 border border-zinc-700/40">
                      <Mic className="size-3 shrink-0 text-zinc-400" />
                      <span className="italic line-clamp-1">
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
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
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
                        className="p-1 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer"
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
              <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">↑↓</kbd> Chọn
            </span>
            <span>·</span>
            <span>
              <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">Enter</kbd> Chèn
            </span>
            <span>·</span>
            <span>
              <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">Ctrl+C</kbd> Sao chép
            </span>
          </div>
          <div>
            <kbd className="px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[9px]">Esc</kbd> Đóng
          </div>
        </div>

        {/* Clear All Confirmation Modal */}
        {showClearConfirm && (
          <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-[340px] rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
              <h3 className="text-sm font-semibold text-zinc-100">
                {t(locale, "historyWindow.clearConfirmTitle")}
              </h3>
              <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                {t(locale, "historyWindow.clearConfirmDesc")}
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1 rounded-md text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  {t(locale, "historyWindow.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="px-3 py-1 rounded-md text-xs font-medium bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer font-semibold"
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
