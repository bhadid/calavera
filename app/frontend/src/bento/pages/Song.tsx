import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { songAlbumPath } from "../../lib/format";
import { BackBar } from "../components/Layout";
import { Notice } from "../components/tiles";

/** A song has no page of its own: this finds the album it is on and goes there. */
export function SongPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const storefront = params.get("sf") ?? "";
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api
      .search(`https://music.apple.com/${storefront}/song/${id}`)
      .then((found) => {
        if (!alive) return;
        const path = found.songs.length ? songAlbumPath(found.songs[0].url) : null;
        if (path) setTarget(path);
        else setError("The album of this song could not be found.");
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The song could not be loaded."));
    return () => {
      alive = false;
    };
  }, [id, storefront]);
  // Replace this address, so that Back on the album page skips it.
  if (target) return <Navigate to={target} replace />;
  return (
    <>
      <BackBar />
      {error ? (
        <div className="notices">
          <Notice tone="bad" role="alert">{error}</Notice>
        </div>
      ) : (
        <p className="empty">Loading…</p>
      )}
    </>
  );
}
