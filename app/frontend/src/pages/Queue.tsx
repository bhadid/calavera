import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import { useConfirm } from "../components/Confirm";
import { JobCard } from "../components/JobCard";

export function QueuePage() {
  const { jobs, jobsLoaded, status, notify } = useStore();
  const confirm = useConfirm();
  const [text, setText] = useState("");
  const [rejected, setRejected] = useState<{ url: string; error: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  // Running first, then queued in the order they will run (oldest first).
  active.sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || a.created_at - b.created_at);
  const finished = jobs.filter((j) => !active.includes(j));

  async function add() {
    const urls = text.split(/\s+/).filter(Boolean);
    if (urls.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const result = await api.addJobs(urls);
      setRejected(result.rejected);
      // Keep only the links that were refused, so they can be corrected.
      setText(result.rejected.map((r) => r.url).join("\n"));
      if (result.added.length) notify(`${result.added.length} added to the queue.`, "success");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "The links could not be added.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void add();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter adds; Shift+Enter makes a new line for another link.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void add();
    }
  }

  async function clearHistory() {
    const removable = finished.filter((j) => !j.has_files);
    const kept = finished.length - removable.length;
    const ok = await confirm({
      title: "Clear history?",
      message:
        `${removable.length} finished ${removable.length === 1 ? "entry" : "entries"} will be removed from this list. ` +
        (kept ? `${kept} with files still in staging will be kept. ` : "") +
        "Your library is not touched.",
      action: "Clear history",
      destructive: true,
    });
    if (!ok) return;
    await Promise.allSettled(removable.map((j) => api.removeJob(j.id)));
  }

  const wrapper = status?.wrapper;
  return (
    <>
      <div className="page-head">
        <h1>
          <span className="prompt" aria-hidden="true">
            ❯
          </span>
          Queue
        </h1>
      </div>
      {wrapper && !wrapper.ready && wrapper.phase !== "starting" && (
        <div className="callout callout-warn" role="alert">
          <span className="tag callout-tag">!</span>
          <div>
            <strong>Not signed in to Apple Music.</strong> Downloads will fail until you <Link to="/account">sign in</Link>.
          </div>
        </div>
      )}
      {status && !status.library.ok && (
        <div className="callout callout-bad" role="alert">
          <span className="tag callout-tag">!</span>
          <div>
            <strong>The music library is not available.</strong> {status.library.problem}
          </div>
        </div>
      )}

      <form className="card add" onSubmit={submit}>
        <label className="field-label" htmlFor="links">
          Add Apple Music links
        </label>
        <div className="prompt-field">
          <span className="prompt" aria-hidden="true">
            ❯
          </span>
          <textarea
            id="links"
            className="textarea"
            rows={Math.min(6, Math.max(1, text.split("\n").length))}
            placeholder="music.apple.com/…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            enterKeyHint="go"
            aria-describedby="links-help"
          />
        </div>
        {rejected.length > 0 && (
          <ul className="rejected" role="alert">
            {rejected.map((r) => (
              <li key={r.url}>
                <strong>{r.error}</strong>
                <br />
                {r.url}
              </li>
            ))}
          </ul>
        )}
        <div className="add-row">
          <p className="small muted" id="links-help">
            Album or song links. Shift+Enter for another line. Or <Link to="/search">search the catalogue</Link>.
          </p>
          <button className="button button-primary" disabled={submitting || !text.trim()}>
            <span aria-hidden="true">↓</span> Add to queue
          </button>
        </div>
      </form>

      <section className="section" aria-labelledby="active-heading">
        <div className="section-head">
          <h2 id="active-heading">
            In progress <span className="muted">[{active.length}]</span>
          </h2>
        </div>
        {active.length === 0 ? (
          <p className="empty">{jobsLoaded ? "Nothing in the queue." : "Loading…"}</p>
        ) : (
          <div className="stack">
            {active.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>

      {finished.length > 0 && (
        <section className="section" aria-labelledby="history-heading">
          <div className="section-head">
            <h2 id="history-heading">
              History <span className="muted">[{finished.length}]</span>
            </h2>
            <button className="button button-small button-plain" onClick={clearHistory}>
              Clear history
            </button>
          </div>
          <div className="stack">
            {finished.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
