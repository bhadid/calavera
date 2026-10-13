import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { ArtistDetail } from "../lib/types";
import { AlbumGrid } from "../components/AlbumGrid";
import { Segmented } from "../components/Controls";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { StaleNote } from "../components/StaleNote";

export function ArtistPage() {
  const { id = "" } = useParams();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  // Which list is shown lives in the URL, so that coming back from an album
  // returns to the same list.
  const [params, setParams] = useSearchParams();

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
  // With both kinds, a segmented control switches between them: an artist
  // with many albums would otherwise bury the singles far down the page.
  const both = albums.length > 0 && singles.length > 0;
  const lists = [
    { value: "albums", name: "Albums", items: albums },
    { value: "singles", name: "Singles and EPs", items: singles },
  ].filter((list) => list.items.length > 0);
  const shown = both ? (lists.find((list) => list.value === params.get("show")) ?? lists[0]) : undefined;
  return (
    <>
      <div className="section">
        {back}
        <StaleNote since={artist.stale_since} />
        <div className="artist-head">
          <Cover src={artist.artwork} size={96} round />
          <div>
            <h1>{artist.name}</h1>
            {!both && (
              <p className="muted">
                {albums.length} albums · {singles.length} singles and EPs
              </p>
            )}
            {artist.more && (
              <p className="small muted">Apple Music lists more than these {artist.albums.length}. Search for a title to find the others.</p>
            )}
          </div>
        </div>
        {shown && (
          <Segmented
            label="Releases shown"
            value={shown.value}
            options={lists.map((list) => ({ value: list.value, label: `${list.name} [${list.items.length}]` }))}
            onChange={(show) => setParams({ show }, { replace: true })}
          />
        )}
      </div>
      {shown ? (
        <section className="section" aria-label={shown.name}>
          <AlbumGrid albums={shown.items} artistId={artist.id} />
        </section>
      ) : (
        lists.map((list) => (
          <section className="section" key={list.value}>
            <div className="section-head">
              <h2>
                {list.name} <span className="muted">[{list.items.length}]</span>
              </h2>
            </div>
            <AlbumGrid albums={list.items} artistId={artist.id} />
          </section>
        ))
      )}
    </>
  );
}
