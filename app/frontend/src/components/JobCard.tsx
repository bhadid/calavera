import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { plural, timeOfDay } from "../lib/format";
import { useStore } from "../lib/store";
import type { Job, JobStatus, LogLine } from "../lib/types";
import { ArtistNames } from "./ArtistNames";
import { useConfirm } from "./Confirm";
import { Cover } from "./Cover";
import { Icon } from "./Icon";

const STATUS: Record<JobStatus, { label: string; tone: string }> = {
  queued: { label: "queued", tone: "" },
  running: { label: "running", tone: "tag-accent" },
  done: { label: "in library", tone: "tag-ok" },
  skipped: { label: "already owned", tone: "tag-info" },
  failed: { label: "failed", tone: "tag-bad" },
  canceled: { label: "canceled", tone: "tag-ghost" },
  interrupted: { label: "interrupted", tone: "tag-warn" },
};

const STAGE: Record<string, string> = {
  preparing: "preparing",
  downloading: "downloading",
  verifying: "verifying",
  converting: "converting to flac",
  importing: "copying to library",
};

const BAR_CELLS = 24;

/** A text progress bar, [████░░░░] 42%, backed by a real progressbar role. */
function Meter({ fraction, caption }: { fraction: number; caption: string }) {
  const percent = Math.round(fraction * 100);
  const filled = Math.round(fraction * BAR_CELLS);
  return (
    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%, ${caption}`}>
      <span className="meter-bar" aria-hidden="true">
        [{"█".repeat(filled)}
        <span className="rest">{"░".repeat(BAR_CELLS - filled)}</span>] {String(percent).padStart(3, " ")}%
      </span>
      <span className="small muted">{caption}</span>
    </div>
  );
}

function lineClass(line: string): string | undefined {
  if (line.startsWith("✔")) return "ok";
  if (line.startsWith("✖") || /\b(error|failed)\b/i.test(line)) return "err";
  return undefined;
}

function JobLog({ job }: { job: Job }) {
  const { onLog } = useStore();
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const body = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .job(job.id)
      .then((r) => alive && setLines(r.log))
      .catch(() => alive && setLines([]));
    const off = onLog(job.id, (line, ts) => setLines((all) => [...(all ?? []), { line, ts }]));
    return () => {
      alive = false;
      off();
    };
  }, [job.id, onLog]);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [lines]);

  return (
    <div className="terminal">
      <div className="terminal-bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>job-{job.id}.log</span>
      </div>
      <pre className="terminal-body" ref={body} tabIndex={0} aria-label="Job log">
        {lines === null && <span className="time">loading…</span>}
        {lines?.length === 0 && <span className="time">no output yet</span>}
        {lines?.map((l, i) => (
          <div key={i} className={lineClass(l.line)}>
            <span className="time">{timeOfDay(l.ts)}</span> {l.line}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** A folder in the library, with a trailing slash to show it is one: Artist/Album/ */
const folder = (path: string) => `${path}/`;

export function JobCard({ job }: { job: Job }) {
  const { notify } = useStore();
  const confirm = useConfirm();
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = STATUS[job.status];
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
      title: "Discard downloaded files?",
      message: `The files this job left in the staging folder for “${name}” will be deleted. Your library is not touched.`,
      action: "Discard files",
      destructive: true,
    });
    if (ok) await act(() => api.discardFiles(job.id));
  }

  async function remove() {
    // Removing a job that left nothing behind loses only a history entry.
    if (job.has_files) {
      const ok = await confirm({
        title: "Remove this job?",
        message: `“${name}” still has downloaded files in the staging folder. Removing the job deletes them. Your library is not touched.`,
        action: "Remove and delete files",
        destructive: true,
      });
      if (!ok) return;
    }
    await act(() => api.removeJob(job.id));
  }

  return (
    <article className={`card job job-${job.status}`} aria-label={`${name}: ${status.label}`}>
      <Cover src={job.artwork_url} size={76} />
      <div className="job-body">
        <div className="job-head">
          <div className="job-titles">
            <h3 title={job.title || job.url}>
              {/* The album's page; for a song, the page of the album it is on. */}
              <Link to={`/${job.kind}/${job.apple_id}?sf=${job.storefront}`} className="quiet-link">
                {job.title || (job.kind === "album" ? "Album" : "Song")}
              </Link>
            </h3>
            <p className="muted">{job.artist ? <ArtistNames name={job.artist} artists={job.artists} /> : job.url}</p>
          </div>
          <span className="job-tags">
            {job.status === "done" && job.result.some((r) => (r.unavailable ?? 0) > 0) && <span className="tag tag-warn">partial</span>}
            <span className={`tag ${status.tone}`}>
              {job.status === "done" && <Icon name="check" size={13} />}
              {status.label}
            </span>
          </span>
        </div>
        {selection > 0 && active && <p className="small muted">{plural(selection, "selected song")}</p>}

        {job.status === "running" && (
          <Meter fraction={job.progress} caption={[STAGE[job.stage] ?? "working", job.detail.toLowerCase()].filter(Boolean).join(" · ")} />
        )}

        {(job.status === "failed" || job.status === "interrupted") && job.error && <p className="job-error">{job.error}</p>}
        {(job.status === "skipped" || job.status === "done") && job.detail && <p className="small muted">{job.detail}</p>}
        {canKeep && (
          <p className="small muted">
            {plural(job.staged_tracks, "track")} finished downloading and can be kept.
          </p>
        )}

        {job.result.map((r, i) => (
          <p key={i} className="small job-result">
            {r.status === "imported" && (
              <>
                {folder(r.path)}
                {r.tracks ? ` · ${plural(r.tracks, "track")}` : ""}
                {r.tracks && r.album_tracks && !selection && r.tracks < r.album_tracks ? ` of ${r.album_tracks}` : ""}
                {r.format ? ` · ${r.format.toUpperCase()}` : ""}
                {r.quality?.length ? ` · ${r.quality.join(", ")}` : ""}
              </>
            )}
            {r.status === "exists" && <>existing folder: {folder(r.path)}</>}
          </p>
        ))}

        <div className="job-actions">
          {active && (
            <button className="button button-small" disabled={busy} onClick={() => act(() => api.cancelJob(job.id))}>
              Cancel
            </button>
          )}
          {canKeep && (
            <button
              className="button button-small button-primary"
              disabled={busy}
              title="Convert and import the tracks that finished downloading. Existing files in the library are never replaced."
              onClick={() => act(() => api.importJob(job.id))}
            >
              Keep {plural(job.staged_tracks, "track")}
            </button>
          )}
          {canAddMissing && (
            <button
              className="button button-small"
              disabled={busy}
              title="Add only the tracks the existing album folder does not have. Existing files are never replaced."
              onClick={() => act(() => api.importJob(job.id))}
            >
              Add missing tracks
            </button>
          )}
          {!active && job.status !== "done" && (
            <button className="button button-small" disabled={busy} onClick={() => act(() => api.retryJob(job.id))}>
              Retry
            </button>
          )}
          {!active && job.has_files && (
            <button className="button button-small" disabled={busy} onClick={discard}>
              Discard files
            </button>
          )}
          {!active && (
            <button className="button button-small button-plain" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button className="button button-small button-plain" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
            {showLog ? "▾ hide log" : "▸ show log"}
          </button>
        </div>
        {showLog && <JobLog job={job} />}
      </div>
    </article>
  );
}
