import { useEffect, useRef } from "react";
import { timeOfDay } from "../../lib/format";
import { useJobLog } from "../../lib/hooks/jobActions";

function lineClass(line: string): string | undefined {
  if (line.startsWith("✔")) return "ok";
  if (line.startsWith("✖") || /\b(error|failed)\b/i.test(line)) return "err";
  return undefined;
}

/** A job's log, following new lines as they come. */
export function JobLog({ jobId }: { jobId: string }) {
  const lines = useJobLog(jobId);
  const body = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [lines]);
  return (
    <pre className="console" ref={body} tabIndex={0} aria-label="Log">
      {lines === null && <span className="time">Loading…</span>}
      {lines?.length === 0 && <span className="time">No output yet.</span>}
      {lines?.map((l, i) => (
        <div key={i} className={lineClass(l.line)}>
          <span className="time">{timeOfDay(l.ts)}</span> {l.line}
        </div>
      ))}
    </pre>
  );
}
