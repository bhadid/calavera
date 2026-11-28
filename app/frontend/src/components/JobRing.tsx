import type { Job } from "../lib/types";

// The circumference of the ring's circle (r = 9 on the 24 x 24 icon grid).
const C = 2 * Math.PI * 9;

/**
 * Where a queued or running job is, in the place of an icon. Queued: a dotted
 * ring at rest, waiting. Running: the ring fills with the job's progress; at
 * 0 (still preparing) a short arc turns instead, as there is nothing to show
 * yet. With reduced motion the arc stands still.
 */
export function JobRing({ job, size = 16 }: { job: Pick<Job, "status" | "progress">; size?: number }) {
  const running = job.status === "running";
  const progress = Math.min(1, Math.max(0, job.progress || 0));
  return (
    <svg className="icon job-ring" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {running ? (
        <>
          <circle className="job-ring-track" cx="12" cy="12" r="9" strokeWidth={2.4} />
          {progress > 0 ? (
            <circle
              className="job-ring-arc"
              cx="12"
              cy="12"
              r="9"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              transform="rotate(-90 12 12)"
            />
          ) : (
            <circle
              className="job-ring-arc job-ring-start"
              cx="12"
              cy="12"
              r="9"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray={`${C / 4} ${C}`}
            />
          )}
        </>
      ) : (
        <circle className="job-ring-wait" cx="12" cy="12" r="9" strokeWidth={2.2} strokeLinecap="round" strokeDasharray="2.2 3.4" />
      )}
    </svg>
  );
}
