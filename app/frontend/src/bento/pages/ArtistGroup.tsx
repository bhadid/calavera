import { Link, Navigate, useParams } from "react-router-dom";
import { groupTitle, useArtistGroup, type Shown } from "../../lib/hooks/artistGroup";
import { atTime } from "../../lib/format";
import { AlbumTile } from "../components/AlbumTile";
import { BackBar } from "../components/Layout";
import { Notice } from "../components/tiles";

/** All releases of one group of an artist, loaded page by page while scrolling. */
export function ArtistGroupPage() {
  const { id = "", group = "" } = useParams();
  const { state, items, error, setError, more, end, finished, valid } = useArtistGroup(id, group);
  if (!valid) return <Navigate to={`/artist/${id}`} replace />;
  const title = groupTitle(group as Shown);
  return (
    <>
      <BackBar fallback={`/artist/${id}`} />
      <header className="top" style={{ paddingTop: 4 }}>
        <h1>{title}</h1>
        {state.artist && (
          <p className="subtitle">
            <Link to={`/artist/${id}`} className="quiet-link">
              {state.artist}
            </Link>
          </p>
        )}
      </header>
      {state.staleSince && (
        <div className="notices">
          <Notice tone="warn" role="status">
            Apple Music can't be reached right now. Showing what was loaded {atTime(state.staleSince)}.
          </Notice>
        </div>
      )}
      {error && state.items.length === 0 && (
        <div className="notices">
          <Notice tone="bad" role="alert">{error}</Notice>
        </div>
      )}
      <section aria-label={title}>
        {items.length > 0 && (
          <div className="bento-cards">
            {items.map((album) => (
              <AlbumTile key={album.id} album={album} showArtist={group === "appears_on"} />
            ))}
          </div>
        )}
        {finished && state.items.length === 0 && !error && <p className="empty">Apple Music lists nothing here.</p>}
        <div ref={end} />
        {!finished && !error && <p className="empty">Loading…</p>}
        {error && state.items.length > 0 && (
          <p className="empty" role="status">
            {error}{" "}
            <button className="btn btn-plain btn-small" onClick={() => (setError(""), void more())}>
              Try again
            </button>
          </p>
        )}
      </section>
    </>
  );
}
