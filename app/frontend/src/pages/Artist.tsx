import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { Album, Artist } from "../lib/types";
import { AlbumGrid } from "../components/AlbumGrid";
import { Cover } from "../components/Cover";

export function ArtistPage() {
  const { id = "" } = useParams();
  const [artist, setArtist] = useState<(Artist & { albums: Album[] }) | null>(null);
  const [error, setError] = useState("");

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

  const back = (
    <Link to="/search" className="backlink">
      ← Search
    </Link>
  );
  if (error) {
    return (
      <>
        {back}
        <div className="callout callout-bad" role="alert">
          <span className="tag callout-tag">!</span>
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
        <div className="artist-head">
          <Cover src={artist.artwork} size={96} round />
          <div>
            <h1>{artist.name}</h1>
            <p className="muted">
              {albums.length} albums · {singles.length} singles and EPs
            </p>
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
          <AlbumGrid albums={albums} />
        </section>
      )}
      {singles.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>
              Singles and EPs <span className="muted">[{singles.length}]</span>
            </h2>
          </div>
          <AlbumGrid albums={singles} />
        </section>
      )}
    </>
  );
}
