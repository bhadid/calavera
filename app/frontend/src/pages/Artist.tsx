import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { GROUP_NAMES } from "../lib/format";
import type { ArtistDetail } from "../lib/types";
import { BackButton, LoadError } from "../components/BackButton";
import { Cover } from "../components/Cover";
import { Shelf } from "../components/Shelf";
import { StaleNote } from "../components/StaleNote";

/**
 * An artist page as in Apple's Music app: a row of the first releases for
 * each group in Apple's grouping (albums, singles and EPs, live albums,
 * compilations, appearances), each leading to the whole group. One request
 * to Apple, so it opens quickly.
 */
export function ArtistPage() {
  const { id = "" } = useParams();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
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

  if (error) return <LoadError message={error} />;
  if (!artist) {
    return (
      <>
        <BackButton />
        <p className="empty">Loading…</p>
      </>
    );
  }
  return (
    <>
      <div className="section">
        <BackButton />
        <StaleNote since={artist.stale_since} />
        <div className="artist-head">
          <Cover src={artist.artwork} size={96} round />
          <h1>{artist.name}</h1>
        </div>
      </div>
      {artist.shelves.length === 0 && <p className="empty">Apple Music lists no releases for this artist.</p>}
      {artist.shelves.map((shelf) => (
        <Shelf
          key={shelf.group}
          title={GROUP_NAMES[shelf.group]}
          to={`/artist/${artist.id}/${shelf.group}`}
          albums={shelf.items}
          artistId={artist.id}
        />
      ))}
    </>
  );
}
