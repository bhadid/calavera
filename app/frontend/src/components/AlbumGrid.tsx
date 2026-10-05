import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { albumPath, plural, qualityLabel, year } from "../lib/format";
import { useStore } from "../lib/store";
import type { Album } from "../lib/types";
import { Cover } from "./Cover";

/** Queues an item, or shows that it is already queued or owned. */
export function QueueButton({
  url,
  appleId,
  inLibrary,
  block = false,
}: {
  url: string;
  appleId: string;
  inLibrary?: string | null;
  block?: boolean;
}) {
  const { jobs, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const job = jobs.find((j) => j.apple_id === appleId);

  if (job?.status === "queued" || job?.status === "running") {
    return <span className="owned">{job.status === "running" ? "downloading…" : "queued"}</span>;
  }
  if (inLibrary || job?.status === "done") {
    return (
      <span className="owned owned-ok" title={inLibrary ?? undefined}>
        <span aria-hidden="true">✓</span> in library
      </span>
    );
  }
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
  return (
    <button className={`button button-primary button-small${block ? " button-block" : ""}`} disabled={busy} onClick={add}>
      <span aria-hidden="true">↓</span> Download
    </button>
  );
}

export function AlbumGrid({ albums }: { albums: Album[] }) {
  return (
    <div className="grid">
      {albums.map((album) => {
        const quality = qualityLabel(album.traits);
        return (
          <article key={album.id} className="card album">
            {/* The cover and title open the album's page, where single songs can be chosen. */}
            <Link to={albumPath(album.url) ?? `/album/${album.id}`} className="album-link" aria-label={`${album.name}: show songs`}>
              <Cover src={album.artwork} size={180} />
            </Link>
            <div className="album-text">
              <h3 title={album.name}>
                <Link to={albumPath(album.url) ?? `/album/${album.id}`}>{album.name}</Link>
              </h3>
              <p className="artist muted" title={album.artist}>
                {album.artist}
              </p>
              <p className="small muted">
                {[year(album.release_date), plural(album.track_count, "track")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="album-tags">
                {quality && <span className={`tag ${quality.startsWith("Hi-Res") ? "tag-accent" : ""}`}>{quality}</span>}
                {album.explicit && (
                  <span className="tag tag-ghost" title="Explicit">
                    E<span className="sr-only">xplicit</span>
                  </span>
                )}
              </div>
            </div>
            <QueueButton url={album.url} appleId={album.id} inLibrary={album.in_library} block />
          </article>
        );
      })}
    </div>
  );
}
