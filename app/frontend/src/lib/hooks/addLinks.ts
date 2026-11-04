import { useState } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";

/** Adding pasted Apple Music links to the queue; refused links stay to be corrected. */
export function useAddLinks(onAdded?: (count: number) => void) {
  const { notify } = useStore();
  const [rejected, setRejected] = useState<{ url: string; error: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  /** Adds the links; resolves to the ones that were refused. */
  async function add(urls: string[]): Promise<string[]> {
    if (urls.length === 0 || submitting) return urls;
    setSubmitting(true);
    try {
      const result = await api.addJobs(urls);
      setRejected(result.rejected);
      if (result.added.length) {
        notify(`${result.added.length} added to the queue.`, "success");
        onAdded?.(result.added.length);
      }
      return result.rejected.map((r) => r.url);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "The links could not be added.", "error");
      return urls;
    } finally {
      setSubmitting(false);
    }
  }
  return { add, rejected, setRejected, submitting };
}
