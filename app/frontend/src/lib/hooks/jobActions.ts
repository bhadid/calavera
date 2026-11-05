import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import type { Job, LogLine } from "../types";
import { useConfirm } from "../../components/Confirm";

/** What can be done with a queue job, with confirmations where files would be lost. */
export function useJobActions(job: Job) {
  const { notify } = useStore();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const active = job.status === "queued" || job.status === "running";
  const name = job.title || (job.kind === "album" ? "this album" : "this song");

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "That did not work.", "error");
    } finally {
      setBusy(false);
    }
  }

  // "Keep downloaded tracks": a download that failed part-way still has
  // finished tracks in staging. "Add missing tracks": the album folder
  // exists; add only what it lacks. Both never replace a file.
  const canKeep = job.status === "failed" && job.staged_tracks > 0;
  const canAddMissing = job.status === "skipped" && job.kind === "album" && !job.options.merge;
  const selection = job.options.track_ids?.length ?? 0;

  async function discard() {
    const ok = await confirm({
      title: "Discard files?",
      message: `Deletes the downloaded files of “${name}”. Your library stays as it is.`,
      action: "Discard",
      destructive: true,
    });
    if (ok) await act(() => api.discardFiles(job.id));
  }

  async function remove() {
    // Removing a job that left nothing behind loses only a history entry.
    if (job.has_files) {
      const ok = await confirm({
        title: "Remove from the queue?",
        message: `Removes “${name}” and deletes its downloaded files. Your library stays as it is.`,
        action: "Remove",
        destructive: true,
      });
      if (!ok) return;
    }
    await act(() => api.removeJob(job.id));
  }

  return {
    busy, active, name, canKeep, canAddMissing, selection,
    cancel: () => act(() => api.cancelJob(job.id)),
    keep: () => act(() => api.importJob(job.id)),
    retry: () => act(() => api.retryJob(job.id)),
    discard, remove,
  };
}

/** The log of one job: what is stored, then live lines as they arrive. */
export function useJobLog(jobId: string) {
  const { onLog } = useStore();
  const [lines, setLines] = useState<LogLine[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .job(jobId)
      .then((r) => alive && setLines(r.log))
      .catch(() => alive && setLines([]));
    const off = onLog(jobId, (line, ts) => setLines((all) => [...(all ?? []), { line, ts }]));
    return () => {
      alive = false;
      off();
    };
  }, [jobId, onLog]);
  return lines;
}
