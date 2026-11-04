import { Link, useParams } from "react-router-dom";
import { albumPath, atTime, GROUP_NAMES, plural, year } from "../../lib/format";
import { useArtist } from "../../lib/hooks/artist";
import type { Album } from "../../lib/types";
import { AlbumTile, kindOf, QualityPill, QueueButton, shortName } from "../components/AlbumTile";
import { Icon } from "../components/Icon";
import { BackBar } from "../components/Layout";
import { Cover, Notice, span, tint } from "../components/tiles";

/**
 * An artist page as in Apple's Music app: the newest release large, then a
 * row of the first releases of each group, each leading to the whole group.
 */
export function ArtistPage() {
  const { id = "" } = useParams();
  const { artist, error } = useArtist(id);

  if (error) {
    return (
      <>
        <BackBar />
        <div className="notices">
          <Notice tone="bad" role="alert">{error}</Notice>
        </div>
      </>
    );
  }
  if (!artist) {
    return (
      <>
        <BackBar />
        <p className="empty">Loading…</p>
      </>
    );
  }
  const { className, style } = tint(artist.colors);
  const latest = artist.shelves
    .filter((s) => s.group !== "appears_on")
    .flatMap((s) => s.items)
    .sort((a, b) => b.release_date.localeCompare(a.release_date))[0];

  return (
    <>
      <BackBar />
      {artist.stale_since && (
        <div className="notices">
          <Notice tone="warn" role="status">
            Apple Music can't be reached right now. Showing what was loaded {atTime(artist.stale_since)}.
          </Notice>
        </div>
      )}
      <div className="bento">
        <section className={`tile${className}`} style={{ ...span(2, 4, latest ? 3 : 6, 1, 2, 2), ...style, justifyContent: "flex-end" }}>
          <div className="tile-head">Artist</div>
          <Cover src={artist.artwork} size={120} round className="avatar" />
          <h1>{artist.name}</h1>
          {artist.shelves.length > 0 && (
            <div className="actions">
              <Link className="btn btn-gray btn-small" to={`/artist/${artist.id}/all`}>
                All releases <Icon name="chevron" size={15} weight={2.4} />
              </Link>
            </div>
          )}
        </section>
        {latest && <LatestTile album={latest} />}
      </div>

      {artist.shelves.length === 0 && <p className="empty">Apple Music lists no releases for this artist.</p>}
      {artist.shelves.map((shelf) => (
        <section key={shelf.group} aria-labelledby={`shelf-${shelf.group}`}>
          <h2 className="section-title" id={`shelf-${shelf.group}`}>
            <Link to={`/artist/${artist.id}/${shelf.group}`}>{GROUP_NAMES[shelf.group]}</Link>
            <Link className="btn btn-plain btn-small" to={`/artist/${artist.id}/${shelf.group}`}>
              See all
            </Link>
          </h2>
          <div className="tile" style={{ paddingBottom: 12 }}>
            <div className="shelf">
              {shelf.items.map((album) => (
                <AlbumTile key={album.id} album={album} showArtist={shelf.group === "appears_on"} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

function LatestTile({ album }: { album: Album }) {
  const { className, style } = tint(album.colors);
  const to = albumPath(album.url) ?? `/album/${album.id}`;
  return (
    <section className={`tile${className}`} style={{ ...span(2, 4, 3, 1, 2, 2), ...style }} aria-labelledby="latest-heading">
      <div className="tile-head" id="latest-heading">
        <Icon name="calendar" size={16} />
        Latest release
      </div>
      <div className="top-result">
        <Link to={to} tabIndex={-1} aria-hidden="true">
          <Cover src={album.artwork} />
        </Link>
        <div className="text">
          <Link to={to} className="big">
            {shortName(album.name)}
          </Link>
          <p className="muted">
            {kindOf(album)} · {year(album.release_date)} · {plural(album.track_count, "song")}
          </p>
          <div className="pills">
            <QualityPill traits={album.traits} />
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <QueueButton url={album.url} appleId={album.id} inLibrary={album.in_library} />
          </div>
        </div>
      </div>
    </section>
  );
}
