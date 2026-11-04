import { Link, Navigate, useParams } from "react-router-dom";
import { groupTitle as title, useArtistGroup } from "../lib/hooks/artistGroup";
import { AlbumGrid } from "../components/AlbumGrid";
import { BackButton, LoadError } from "../components/BackButton";
import { StaleNote } from "../components/StaleNote";

export function ArtistGroupPage() {
  const { id = "", group = "" } = useParams();
  const { state, items, error, setError, more, end, finished, valid } = useArtistGroup(id, group);

  if (!valid) return <Navigate to={`/artist/${id}`} replace />;
  if (error && state.items.length === 0) return <LoadError message={error} fallback={`/artist/${id}`} />;
  const shown = group as Parameters<typeof title>[0];
  return (
    <>
      <div className="section">
        <BackButton fallback={`/artist/${id}`} />
        <StaleNote since={state.staleSince} />
        <div>
          <h1>{title(shown)}</h1>
          {state.artist && (
            <p className="muted">
              <Link to={`/artist/${id}`} className="quiet-link">
                {state.artist}
              </Link>
            </p>
          )}
        </div>
      </div>
      <section className="section" aria-label={title(shown)}>
        {items.length > 0 && <AlbumGrid albums={items} artistId={id} />}
        {finished && state.items.length === 0 && <p className="empty">Apple Music lists nothing here.</p>}
        <div ref={end} />
        {!finished && <p className="empty">Loading…</p>}
        {error && state.items.length > 0 && (
          <p className="small muted" role="status">
            {error}{" "}
            <button className="button button-plain button-small" onClick={() => (setError(""), void more())}>
              Try again
            </button>
          </p>
        )}
      </section>
    </>
  );
}
