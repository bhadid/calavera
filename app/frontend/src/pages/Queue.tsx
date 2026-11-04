import { useState } from "react";
import { Link } from "react-router-dom";
import { plural } from "../lib/format";
import { useJobActions } from "../lib/hooks/jobActions";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import type { Job, JobStatus } from "../lib/types";
import { useConfirm } from "../components/Confirm";
import { ArtistNames } from "../components/ArtistNames";
import { Icon, type IconName } from "../components/Icon";
import { JobLog } from "../components/JobLog";
import { Cover, Notice, span, tint } from "../components/tiles";

// History is shown this many jobs at a time, newest first.
const HISTORY_STEP = 40;

const STAGE: Record<string, string> = {
  preparing: "Preparing",
  downloading: "Downloading",
  verifying: "Verifying",
  converting: "Converting to FLAC",
  importing: "Copying to the library",
};

const STATUS: Record<JobStatus, { label: string; tone: string; icon: IconName }> = {
  queued: { label: "Queued", tone: "", icon: "clock" },
  running: { label: "Downloading", tone: "", icon: "download" },
  done: { label: "In library", tone: "ok", icon: "check" },
  skipped: { label: "Already there", tone: "", icon: "info" },
  failed: { label: "Failed", tone: "bad", icon: "warning" },
  canceled: { label: "Canceled", tone: "", icon: "close" },
  interrupted: { label: "Interrupted", tone: "warn", icon: "warning" },
};

const jobPage = (job: Job) => `/${job.kind}/${job.apple_id}?sf=${job.storefront}`;
const jobTitle = (job: Job) => job.title || (job.kind === "album" ? "Album" : "Song");

function day(seconds: number): string {
  const then = new Date(seconds * 1000);
  const today = new Date();
  const days = Math.round((new Date(today).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return then.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export function QueuePage() {
  const { jobs, jobsLoaded, status } = useStore();
  const confirm = useConfirm();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  // Running first, then queued in the order they will run (oldest first).
  active.sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || a.created_at - b.created_at);
  const [now, ...next] = active;
  const finished = jobs.filter((j) => !active.includes(j));
  const [shown, setShown] = useState(HISTORY_STEP);
  const wrapper = status?.wrapper;

  async function clearHistory() {
    const removable = finished.filter((j) => !j.has_files);
    const kept = finished.length - removable.length;
    const ok = await confirm({
      title: "Clear history?",
      message:
        `${removable.length} finished ${removable.length === 1 ? "entry" : "entries"} will be removed from this list. ` +
        (kept ? `${kept} with files still in staging will be kept. ` : "") +
        "Your library is not touched.",
      action: "Clear",
      destructive: true,
    });
    if (ok) await Promise.allSettled(removable.map((j) => api.removeJob(j.id)));
  }

  // History grouped by the day each job finished.
  const groups: { day: string; jobs: Job[] }[] = [];
  for (const job of finished.slice(0, shown)) {
    const label = day(job.finished_at ?? job.created_at);
    if (groups[groups.length - 1]?.day !== label) groups.push({ day: label, jobs: [] });
    groups[groups.length - 1].jobs.push(job);
  }

  return (
    <div className="page">
      <header className="top">
        <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>Queue</h1>
      </header>

      {((wrapper && !wrapper.ready && wrapper.phase !== "starting") || (status && !status.library.ok)) && (
        <div className="notices">
          {wrapper && !wrapper.ready && wrapper.phase !== "starting" && (
            <Notice tone="warn" role="alert">
              {wrapper.phase === "needs_fix" ? (
                <>
                  <strong>The wrapper cannot start.</strong> Downloads will fail until it is fixed. <Link to="/account">Account</Link>
                </>
              ) : (
                <>
                  <strong>Not signed in to Apple Music.</strong> Downloads will fail until you <Link to="/account">sign in</Link>.
                </>
              )}
            </Notice>
          )}
          {status && !status.library.ok && (
            <Notice tone="bad" role="alert">
              <strong>The music library is not available.</strong> {status.library.problem}
            </Notice>
          )}
        </div>
      )}

      {now && (
      <div className="bento">
        {now && <NowTile job={now} />}
        {next.length > 0 && (
          <section className="tile" style={span(2, 4, 6)} aria-labelledby="next-heading">
            <div className="tile-head" id="next-heading">
              <Icon name="clock" size={16} />
              Up next · {next.length}
            </div>
            <ol className="next">
              {next.map((job, index) => (
                <UpNextItem key={job.id} job={job} first={index === 0} />
              ))}
            </ol>
          </section>
        )}
      </div>
      )}
      {!now && (
        <p className="empty">
          {jobsLoaded ? (
            <>
              Nothing in the queue. Find albums and songs in <Link className="link" to="/search">Search</Link>.
            </>
          ) : (
            "Loading…"
          )}
        </p>
      )}

      {finished.length > 0 && (
        <>
          <h2 className="section-title">
            History
            <button className="btn btn-plain" onClick={clearHistory}>
              Clear
            </button>
          </h2>
          <section className="tile" aria-label="History">
            <div className="list" style={{ marginTop: "calc(var(--pad) * -1 + 2px)" }}>
              {groups.map((group) => (
                <div key={group.day} role="group" aria-label={group.day}>
                  <div className="group-label">{group.day}</div>
                  {group.jobs.map((job) => (
                    <HistoryRow key={job.id} job={job} />
                  ))}
                </div>
              ))}
            </div>
            {finished.length > shown && (
              <div className="more">
                <span className="help" role="status">
                  Showing {shown} of {finished.length}
                </span>
                <button className="btn btn-gray btn-small" onClick={() => setShown(shown + HISTORY_STEP)}>
                  Show {Math.min(HISTORY_STEP, finished.length - shown)} more
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function NowTile({ job }: { job: Job }) {
  const { busy, cancel, selection } = useJobActions(job);
  const [log, setLog] = useState(false);
  const { className, style } = tint(job.artwork_colors);
  const running = job.status === "running";
  const percent = Math.round(job.progress * 100);
  const stage = running ? [STAGE[job.stage] ?? "Working", job.detail].filter(Boolean).join(" · ") : "Waiting to start";
  return (
    <section className={`tile${className}`} style={{ ...span(2, 4, 6), ...style }} aria-labelledby="now-heading">
      <div className="tile-head" id="now-heading">
        <Icon name="download" size={16} />
        {running ? "Now downloading" : "Starting"}
      </div>
      <div className="now">
        <Link to={jobPage(job)} tabIndex={-1} aria-hidden="true">
          <Cover src={job.artwork_url} />
        </Link>
        <div className="now-head">
          <Link className="now-title" to={jobPage(job)}>
            {jobTitle(job)}
          </Link>
          <p className="muted">
            {job.artist ? <ArtistNames name={job.artist} artists={job.artists} /> : job.url}
            {selection > 0 && ` · ${plural(selection, "selected song")}`}
          </p>
        </div>
        <div className="now-body">
          <div className="now-stage muted">
            <span>{stage}</span>
            {running && <span className="num">{percent} %</span>}
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent} %, ${stage}`}>
            <span style={{ width: `${running ? percent : 0}%` }} />
          </div>
          <div className="actions" style={{ marginTop: 6 }}>
            <button className="btn btn-gray btn-small" disabled={busy} onClick={cancel}>
              Cancel
            </button>
            <button className="btn btn-gray btn-small" aria-expanded={log} onClick={() => setLog(!log)}>
              <Icon name="terminal" size={16} />
              {log ? "Hide log" : "Show log"}
            </button>
          </div>
        </div>
      </div>
      {log && <JobLog jobId={job.id} />}
    </section>
  );
}

function UpNextItem({ job, first }: { job: Job; first: boolean }) {
  const { busy, cancel } = useJobActions(job);
  return (
    <li className="next-item">
      <Cover src={job.artwork_url} className="cover-sm" />
      <Link className="text" to={jobPage(job)}>
        <strong>{jobTitle(job)}</strong>
        <span>
          {first ? "Next · " : ""}
          {job.artist || job.url}
        </span>
      </Link>
      <button className="btn btn-plain btn-icon" disabled={busy} onClick={cancel} aria-label={`Cancel ${jobTitle(job)}`}>
        <Icon name="close" size={18} />
      </button>
    </li>
  );
}

/** A finished job: one row that opens to its details, actions and log. */
function HistoryRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState(false);
  const { busy, canKeep, canAddMissing, keep, retry, discard, remove, selection } = useJobActions(job);
  const status = STATUS[job.status];
  const partial = job.status === "done" && job.result.some((r) => (r.unavailable ?? 0) > 0);
  const tracks = job.result.reduce((n, r) => n + (r.tracks ?? 0), 0);
  const facts = [job.artist, job.kind === "album" ? "Album" : "Song", tracks ? plural(tracks, "track") : ""].filter(Boolean).join(" · ");
  const id = `job-${job.id}`;
  return (
    <div className="row-group">
      <button className="row" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Cover src={job.artwork_url} className="cover-sm" />
        <span className="row-text">
          <strong>{jobTitle(job)}</strong>
          <span>{facts || job.url}</span>
        </span>
        <span className={`row-end ${status.tone}`}>
          <Icon name={status.icon} size={16} weight={2.4} />
          <span className="label">{partial ? "Partly in library" : status.label}</span>
        </span>
        <span className="chev"><Icon name="chevron" size={16} weight={2.4} /></span>
      </button>
      {open && (
        <div className="details" id={id}>
          {(job.status === "failed" || job.status === "interrupted") && job.error && <p className="error">{job.error}</p>}
          {(job.status === "skipped" || job.status === "done") && job.detail && <p className="muted">{job.detail}</p>}
          {canKeep && <p className="muted">{plural(job.staged_tracks, "track")} finished downloading and can be kept.</p>}
          {job.result.map((r, i) => (
            <p key={i} className="muted path">
              {r.status === "imported" && (
                <>
                  {r.path}/
                  {r.tracks ? ` · ${plural(r.tracks, "track")}` : ""}
                  {r.tracks && r.album_tracks && !selection && r.tracks < r.album_tracks ? ` of ${r.album_tracks}` : ""}
                  {r.format ? ` · ${r.format.toUpperCase()}` : ""}
                  {r.quality?.length ? ` · ${r.quality.join(", ")}` : ""}
                </>
              )}
              {r.status === "exists" && <>Existing folder: {r.path}/</>}
            </p>
          ))}
          <div className="actions">
            <Link className="btn btn-gray btn-small" to={jobPage(job)}>
              Go to album
            </Link>
            {canKeep && (
              <button className="btn btn-filled btn-small" disabled={busy} onClick={keep} title="Convert and import the tracks that finished downloading. Existing files are never replaced.">
                Keep {plural(job.staged_tracks, "track")}
              </button>
            )}
            {canAddMissing && (
              <button className="btn btn-gray btn-small" disabled={busy} onClick={keep} title="Add only the tracks the existing album folder does not have. Existing files are never replaced.">
                Add missing tracks
              </button>
            )}
            {job.status !== "done" && (
              <button className="btn btn-gray btn-small" disabled={busy} onClick={retry}>
                <Icon name="retry" size={16} />
                Retry
              </button>
            )}
            {job.has_files && (
              <button className="btn btn-danger btn-small" disabled={busy} onClick={discard}>
                Discard files
              </button>
            )}
            <button className="btn btn-plain btn-small" disabled={busy} onClick={remove}>
              Remove
            </button>
            <button className="btn btn-plain btn-small" aria-expanded={log} onClick={() => setLog(!log)}>
              {log ? "Hide log" : "Show log"}
            </button>
          </div>
          {log && <JobLog jobId={job.id} />}
        </div>
      )}
    </div>
  );
}
