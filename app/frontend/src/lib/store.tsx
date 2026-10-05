import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Job, ServerEvent, Status } from "./types";

type LogListener = (line: string, ts: number) => void;
type ToastKind = "info" | "error" | "success";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface Store {
  jobs: Job[];
  jobsLoaded: boolean;
  status: Status | null;
  /** True while the live connection to the server is up. */
  connected: boolean;
  refreshStatus: () => void;
  /** Receive live log lines of one job. Returns an unsubscribe function. */
  onLog: (jobId: string, listener: LogListener) => () => void;
  notify: (message: string, kind?: ToastKind) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const logListeners = useRef(new Map<string, Set<LogListener>>());
  const nextToast = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const notify = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextToast.current++;
      setToasts((all) => [...all.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  const refreshStatus = useCallback(() => {
    api.status().then(setStatus).catch(() => undefined);
  }, []);

  // Live job updates. The browser reconnects by itself; on every (re)connect
  // the full list is reloaded so nothing missed while offline stays stale.
  useEffect(() => {
    const load = () =>
      api
        .jobs()
        .then((list) => {
          setJobs(list);
          setJobsLoaded(true);
        })
        .catch(() => undefined);
    load(); // do not depend on the event stream for the first paint
    const source = new EventSource("/api/events");
    source.onopen = () => {
      setConnected(true);
      load();
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as ServerEvent;
      if (event.type === "job") {
        setJobs((all) => {
          const index = all.findIndex((j) => j.id === event.job.id);
          if (index === -1) return [event.job, ...all];
          const copy = all.slice();
          copy[index] = event.job;
          return copy;
        });
      } else if (event.type === "removed") {
        setJobs((all) => all.filter((j) => j.id !== event.id));
      } else if (event.type === "log") {
        logListeners.current.get(event.id)?.forEach((listener) => listener(event.line, event.ts));
      }
    };
    return () => source.close();
  }, []);

  // Status changes slowly, except during a sign-in.
  const busy = status?.wrapper.login.state === "running" || status?.wrapper.login.state === "awaiting_2fa" || !status?.wrapper.ready;
  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, busy ? 2000 : 15000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, busy]);

  const onLog = useCallback((jobId: string, listener: LogListener) => {
    const listeners = logListeners.current;
    if (!listeners.has(jobId)) listeners.set(jobId, new Set());
    listeners.get(jobId)!.add(listener);
    return () => {
      listeners.get(jobId)?.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({ jobs, jobsLoaded, status, connected, refreshStatus, onLog, notify, toasts, dismiss }),
    [jobs, jobsLoaded, status, connected, refreshStatus, onLog, notify, toasts, dismiss],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
