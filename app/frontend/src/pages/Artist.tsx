import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { ArtistDetail } from "../lib/types";
import { AlbumGrid } from "../components/AlbumGrid";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { StaleNote } from "../components/StaleNote";

export function ArtistPage() {
  const { id = "" } = useParams();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setArtist(null);
    setError("");
    api
      .artist(id)
      .then((a) => alive && setArtist(a))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The artist could not be loaded."));
    return () => {
      alive = false;
    };
  }, [id]);

  // Go back to where the user came from; a directly opened link has no history.
  const back = (
    <button className="button button-plain backlink" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/search"))}>
      <Icon name="back" size={16} /> Back
    </button>
  );
  if (error) {
    return (
      <>
        {back}
        <div className="callout callout-bad" role="alert">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>{error}</div>
        </div>
      </>
    );
  }
  if (!artist) {
    return (
      <>
        {back}
        <p className="empty">Loading…</p>
      </>
    );
  }

  const albums = artist.albums.filter((a) => !a.single);
  const singles = artist.albums.filter((a) => a.single);
  return (
    <>
      <div className="section">
        {back}
        <StaleNote since={artist.stale_since} />
        <div className="artist-head">
          <Cover src={artist.artwork} size={96} round />
          <div>
            <h1>{artist.name}</h1>
            <p className="muted">
              {albums.length} albums · {singles.length} singles and EPs
            </p>
            {artist.more && (
              <p className="small muted">Apple Music lists more than these {artist.albums.length}. Search for a title to find the others.</p>
            )}
          </div>
        </div>
      </div>
      {albums.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>
              Albums <span className="muted">[{albums.length}]</span>
            </h2>
          </div>
          <AlbumGrid albums={albums} artistId={artist.id} />
        </section>
      )}
      {singles.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>
              Singles and EPs <span className="muted">[{singles.length}]</span>
            </h2>
          </div>
          <AlbumGrid albums={singles} artistId={artist.id} />
        </section>
      )}
    </>
  );
}
