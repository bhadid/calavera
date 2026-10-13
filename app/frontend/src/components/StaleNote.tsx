import { atTime } from "../lib/format";
import { Icon } from "./Icon";

/** Says that Apple could not be reached and the page shows an older answer. */
export function StaleNote({ since }: { since?: number | null }) {
  if (!since) return null;
  return (
    <div className="callout callout-warn" role="status">
      <span className="callout-icon">
        <Icon name="warning" size={20} />
      </span>
      <div>Apple Music can't be reached right now. Showing what was loaded {atTime(since)}.</div>
    </div>
  );
}
