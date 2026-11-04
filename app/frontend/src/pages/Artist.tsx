import { Link, useParams } from "react-router-dom";
import { atTime, GROUP_NAMES } from "../lib/format";
import { useArtist } from "../lib/hooks/artist";
import { AlbumTile } from "../components/AlbumTile";
import { Icon } from "../components/Icon";
import { BackBar } from "../components/Layout";
import { Cover, Notice, span, tint } from "../components/tiles";

/**
 * An artist page as in Apple's Music app: the artist, then a row of the
 * first releases of each group, each leading to the whole group.
 */
export function ArtistPage() {
  const { id = "" } = useParams();
  const { artist, error } = useArtist(id);

  if (error || !artist) {
    return (
      <div className="page">
        <BackBar />
        {error ? <Notice tone="bad" role="alert">{error}</Notice> : <p className="empty">Loading…</p>}
      </div>
    );
  }
  const { className, style } = tint(artist.colors);
  return (
    <div className="page">
      <BackBar />
      {artist.stale_since && (
        <Notice tone="warn" role="status">
          Apple Music can't be reached right now. Showing what was loaded {atTime(artist.stale_since)}.
        </Notice>
      )}
      <div className="bento">
        <section className={`tile artist-hero${className}`} style={{ ...span(2, 4, 6), ...style }}>
          <Cover src={artist.artwork} size={112} round className="avatar" />
          <div className="text">
            <p className="tile-head">Artist</p>
            <h1>{artist.name}</h1>
            {artist.shelves.length > 0 && (
              <div className="actions">
                <Link className="btn btn-gray btn-small" to={`/artist/${artist.id}/all`}>
                  All releases <Icon name="chevron" size={15} weight={2.4} />
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>

      {artist.shelves.length === 0 && <p className="empty">Apple Music lists no releases for this artist.</p>}
      {artist.shelves.map((shelf) => (
        <section key={shelf.group} className="shelf-section" aria-labelledby={`shelf-${shelf.group}`}>
          <h2 className="section-title" id={`shelf-${shelf.group}`}>
            <Link to={`/artist/${artist.id}/${shelf.group}`}>{GROUP_NAMES[shelf.group]}</Link>
            <Link className="btn btn-plain btn-small" to={`/artist/${artist.id}/${shelf.group}`}>
              See all
            </Link>
          </h2>
          <div className="shelf">
            {shelf.items.map((album) => (
              <AlbumTile key={album.id} album={album} showArtist={shelf.group === "appears_on"} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
