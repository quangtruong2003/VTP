export interface AutosaveQueue<T> {
  enqueue(snapshot: T): void;
  flush(): Promise<void>;
  retry(): void;
  latestFailed(): T | null;
}

export function createAutosaveQueue<T>(
  save: (snapshot: T) => Promise<unknown>,
  onState?: (state: "saving" | "saved" | "error") => void,
): AutosaveQueue<T> {
  let pending: T | null = null;
  let inFlight: Promise<void> | null = null;
  let failed: T | null = null;

  const drain = () => {
    if (inFlight || pending === null) return;
    const snapshot = pending;
    pending = null;
    onState?.("saving");
    inFlight = (async () => {
      try {
        await save(snapshot);
        failed = null;
        onState?.("saved");
      } catch (error) {
        failed = snapshot;
        onState?.("error");
        throw error;
      } finally {
        inFlight = null;
        if (pending !== null) drain();
      }
    })();
    // Enqueue is intentionally fire-and-forget. `flush()` remains the place
    // callers/tests observe failures, while this prevents unhandled rejections.
    void inFlight.catch(() => {});
  };

  return {
    enqueue(snapshot) {
      pending = snapshot;
      drain();
    },
    async flush() {
      while (inFlight || pending !== null) {
        if (!inFlight) drain();
        const current = inFlight;
        if (current) await current;
      }
    },
    retry() {
      if (failed !== null) {
        pending = failed;
        failed = null;
        drain();
      }
    },
    latestFailed() {
      return failed;
    },
  };
}

export interface AutosaveController<T> {
  saveImmediate(snapshot: T): void;
  saveDebounced(snapshot: T): void;
  cancelDebounce(): void;
}

export function createAutosaveController<T>(
  queue: AutosaveQueue<T>,
  debounceMs = 400,
): AutosaveController<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let debounced: T | null = null;

  const cancelDebounce = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    debounced = null;
  };

  return {
    saveImmediate(snapshot) {
      cancelDebounce();
      queue.enqueue(snapshot);
    },
    saveDebounced(snapshot) {
      if (timer) clearTimeout(timer);
      debounced = snapshot;
      timer = setTimeout(() => {
        timer = null;
        const latest = debounced;
        debounced = null;
        if (latest !== null) queue.enqueue(latest);
      }, debounceMs);
    },
    cancelDebounce,
  };
}
