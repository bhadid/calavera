import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bytes, plural, timeLeft } from "../lib/format";
import { useJobActions } from "../lib/hooks/jobActions";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import type { Job, JobFile, JobStatus } from "../lib/types";
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
  ready: { label: "Ready to download", tone: "ok", icon: "download" },
  skipped: { label: "Already there", tone: "", icon: "info" },
  failed: { label: "Failed", tone: "bad", icon: "warning" },
  canceled: { label: "Canceled", tone: "", icon: "close" },
  interrupted: { label: "Interrupted", tone: "warn", icon: "warning" },
};

const jobPage = (job: Job) => `/${job.kind}/${job.apple_id}?sf=${job.storefront}`;
const jobTitle = (job: Job) => job.title || (job.kind === "album" ? "Album" : "Song");
const forDevice = (job: Job) => job.options.destination === "device";
const readyToFetch = (job: Job) => job.status === "ready" && job.has_files;

/** When ready jobs' files are deleted: the two settings (defaults until they are known). */
interface Keep {
  hours: number;
  afterDownload: boolean;
  /** The time now, in seconds; moves on every 30 seconds for the countdowns. */
  now: number;
}
// The server keeps a download this long after it was sent completely (jobs.FETCHED_GRACE).
const FETCHED_GRACE = 600;

function useKeep(): Keep {
  const [keep, setKeep] = useState({ hours: 24, afterDownload: true });
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((r) => alive && setKeep({ hours: r.settings.keep_ready_hours, afterDownload: r.settings.delete_after_download }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return { ...keep, now };
}

/** "Deleted in 23 h 59 min", or once downloaded "Downloaded · deleted in 9 min". */
function keptUntil(job: Job, keep: Keep): string {
  if (!job.finished_at) return "";
  const byTime = job.finished_at + keep.hours * 3600;
  if (!job.fetched_at) return `Deleted in ${timeLeft(byTime - keep.now)}`;
  const at = keep.afterDownload ? Math.min(byTime, job.fetched_at + FETCHED_GRACE) : byTime;
  return `Downloaded · deleted in ${timeLeft(at - keep.now)}`;
}

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
  // Only what still waits to be downloaded; a downloaded one stays in the history.
  const ready = finished.filter((j) => readyToFetch(j) && !j.fetched_at);
  const keep = useKeep();
  const [shown, setShown] = useState(HISTORY_STEP);
  const wrapper = status?.wrapper;

  async function clearHistory() {
    const removable = finished.filter((j) => !j.has_files);
    const kept = finished.length - removable.length;
    const ok = await confirm({
      title: "Clear history?",
      message:
        `Removes ${removable.length} ${removable.length === 1 ? "entry" : "entries"} from this list` +
        (kept ? `, but keeps ${kept} with files.` : ".") +
        " Your library stays as it is.",
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

      {(now || ready.length > 0) && (
      <div className="bento bento-fit">
        {ready.length > 0 && <ReadyTile jobs={ready} keep={keep} />}
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
                    <HistoryRow key={job.id} job={job} policy={keep} />
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

/** Jobs whose files wait for the browser, newest first, each a tap from the download. */
function ReadyTile({ jobs, keep }: { jobs: Job[]; keep: Keep }) {
  return (
    <section className="tile" style={span(2, 4, 6)} aria-labelledby="ready-heading">
      <div className="tile-head" id="ready-heading">
        <Icon name="download" size={16} />
        Ready to download · {jobs.length}
      </div>
      <ol className="next ready-list">
        {jobs.map((job) => (
          <li key={job.id} className="next-item">
            <Cover src={job.artwork_url} className="cover-sm" />
            <Link className="text" to={jobPage(job)}>
              <strong>{jobTitle(job)}</strong>
              {job.artist && <span>{job.artist}</span>}
              <span>{keptUntil(job, keep)}</span>
            </Link>
            <a className="btn btn-filled btn-small" href={api.downloadUrl(job.id)} download aria-label={`Download ${jobTitle(job)}`}>
              <Icon name="download" size={16} weight={2.2} />
              <span className="btn-text">Download</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A ready job's files, one link each: the fallback when the whole download fails. */
function FileList({ jobId }: { jobId: string }) {
  const [files, setFiles] = useState<JobFile[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api
      .jobFiles(jobId)
      .then((list) => alive && setFiles(list))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "The files could not be listed."));
    return () => {
      alive = false;
    };
  }, [jobId]);
  if (error) return <p className="error">{error}</p>;
  if (!files) return <p className="muted">Loading…</p>;
  return (
    <ul className="file-list">
      {files.map((f) => (
        <li key={f.index}>
          <a className="link" href={api.fileUrl(jobId, f.index)} download>
            {f.name.split("/").pop()}
          </a>
          <span className="muted num">{bytes(f.size)}</span>
        </li>
      ))}
    </ul>
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
        {running ? (forDevice(job) ? "Now downloading for this device" : "Now downloading") : "Starting"}
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
function HistoryRow({ job, policy }: { job: Job; policy: Keep }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState(false);
  const [files, setFiles] = useState(false);
  const fetchable = readyToFetch(job);
  const { busy, canKeep, canAddMissing, keep, retry, discard, remove, selection } = useJobActions(job);
  const status = STATUS[job.status];
  const partial = job.status === "done" && job.result.some((r) => (r.unavailable ?? 0) > 0);
  // Downloaded to a device is done as much as being in the library is.
  const succeeded = (job.status === "done" && !partial) || (job.status === "ready" && Boolean(job.fetched_at));
  const expired = job.status === "ready" && !job.has_files && !job.fetched_at;
  // In the library (added, or found there): it downloads straight from there.
  const inLibrary =
    (job.status === "done" || job.status === "skipped") && job.result.some((r) => r.status === "imported" || r.status === "exists");
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
        {/* A job that did what it was asked says nothing, like a command that succeeds. */}
        {!succeeded && (
          <span className={`row-end ${partial || expired ? "" : status.tone}`}>
            <Icon name={partial ? "info" : expired ? "clock" : status.icon} size={16} weight={2.4} />
            <span className="label">{expired ? "Expired" : partial ? "Partly in library" : status.label}</span>
          </span>
        )}
        <span className="chev"><Icon name="chevron" size={16} weight={2.4} /></span>
      </button>
      {open && (
        <div className="details" id={id}>
          {(job.status === "failed" || job.status === "interrupted") && job.error && <p className="error">{job.error}</p>}
          {(job.status === "skipped" || job.status === "done") && job.detail && <p className="muted">{job.detail}</p>}
          {canKeep && <p className="muted">{plural(job.staged_tracks, "track")} finished downloading and can be kept.</p>}
          {job.status === "ready" && (
            <p className="muted">
              {fetchable ? `${keptUntil(job, policy)}.` : job.fetched_at ? "Downloaded to a device." : "Expired before it was downloaded."}
            </p>
          )}
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
              {r.status === "ready" && fetchable && (
                <>
                  {[r.tracks ? plural(r.tracks, "track") : "", r.format?.toUpperCase(), r.quality?.join(", ")].filter(Boolean).join(" · ")}
                </>
              )}
            </p>
          ))}
          <div className="actions">
            {fetchable && (
              <a className="btn btn-filled btn-small" href={api.downloadUrl(job.id)} download>
                <Icon name="download" size={16} weight={2.2} />
                Download
              </a>
            )}
            {inLibrary && (
              <a className="btn btn-gray btn-small" href={api.downloadUrl(job.id)} download title="Download from the library to this device">
                <Icon name="download" size={16} weight={2.2} />
                Download
              </a>
            )}
            <Link className="btn btn-gray btn-small" to={jobPage(job)}>
              Go to album
            </Link>
            {fetchable && (
              <button className="btn btn-gray btn-small" aria-expanded={files} onClick={() => setFiles(!files)}>
                {files ? "Hide single files" : "Show single files"}
              </button>
            )}
            {fetchable && (
              <button className="btn btn-gray btn-small" disabled={busy} onClick={keep} title="Add these songs to the library. Existing files are never replaced.">
                <Icon name="plus" size={16} />
                Add to library
              </button>
            )}
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
            {/* Only where running again can change something: not for what is in the library
                (done, already there) or reached the device; the album page is the place for those. */}
            {(job.status === "failed" || job.status === "interrupted" || job.status === "canceled" || expired) && (
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
            {/* While the files wait, Discard deletes them; the entry goes with Remove after. */}
            {!fetchable && (
              <button className="btn btn-plain btn-small" disabled={busy} onClick={remove}>
                Remove
              </button>
            )}
            <button className="btn btn-plain btn-small" aria-expanded={log} onClick={() => setLog(!log)}>
              {log ? "Hide log" : "Show log"}
            </button>
          </div>
          {files && fetchable && <FileList jobId={job.id} />}
          {log && <JobLog jobId={job.id} />}
        </div>
      )}
    </div>
  );
}
