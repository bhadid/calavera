import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { albumPath, plural, qualityLabel, year } from "../lib/format";
import { useStore } from "../lib/store";
import type { Album } from "../lib/types";
import { ArtistNames } from "./ArtistNames";
import { Cover } from "./Cover";
import { Icon } from "./Icon";

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
        <Icon name="check" size={14} /> in library
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
      <Icon name="download" size={16} /> Download
    </button>
  );
}

/** `artistId`: the artist whose page the grid is on, who is then not linked. */
export function AlbumGrid({ albums, artistId }: { albums: Album[]; artistId?: string }) {
  return (
    <div className="grid">
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} artistId={artistId} />
      ))}
    </div>
  );
}

export function AlbumCard({ album, artistId }: { album: Album; artistId?: string }) {
  const quality = qualityLabel(album.traits);
  return (
    <article className="card album">
      {/* The cover and title open the album's page, where single songs can be chosen. */}
      <Link to={albumPath(album.url) ?? `/album/${album.id}`} className="album-link" aria-label={`${album.name}: show songs`}>
        <Cover src={album.artwork} size={180} />
      </Link>
      <div className="album-text">
        <h3 title={album.name}>
          <Link to={albumPath(album.url) ?? `/album/${album.id}`}>{album.name}</Link>
        </h3>
        <p className="artist muted" title={album.artist}>
          <ArtistNames name={album.artist} artists={album.artists} except={artistId} />
        </p>
        <p className="small muted">
          {[year(album.release_date), plural(album.track_count, "track")]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {album.same_title && album.label && (
          <p className="small muted" title="Apple Music lists another release under this title.">
            Label · {album.label}
          </p>
        )}
        {album.other_release && (
          <p className="small muted" title="Apple Music lists another release under this title; this is a further one.">
            {["Other release", album.label].filter(Boolean).join(" · ")}
          </p>
        )}
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
}
