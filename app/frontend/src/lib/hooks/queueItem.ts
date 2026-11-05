import { useState } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";

/** Whether an album or song is queued, running or owned, and a way to queue it. */
export function useQueueItem(url: string, appleId: string, inLibrary?: string | null) {
  const { jobs, notify } = useStore();
  const [busy, setBusy] = useState(false);
  // Only jobs for the library: a download to the device does not make it owned.
  const job = jobs.find((j) => j.apple_id === appleId && (j.options.destination ?? "library") === "library");
  const state: "queued" | "running" | "owned" | "available" =
    job?.status === "queued" ? "queued" : job?.status === "running" ? "running" : inLibrary || job?.status === "done" ? "owned" : "available";

  async function add() {
    setBusy(true);
    try {
      const result = await api.addJobs([url]);
      if (result.rejected.length) notify(result.rejected[0].error, "error");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Could not add that to the queue.", "error");
    } finally {
      setBusy(false);
    }
  }
  return { state, busy, add };
}
