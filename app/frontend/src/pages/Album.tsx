import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { duration, plural, qualityLabel, year } from "../lib/format";
import { useStore } from "../lib/store";
import type { AlbumDetail, Track } from "../lib/types";
import { ArtistNames } from "../components/ArtistNames";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";

/** Why a song cannot be chosen, in words; null if it can. */
function blocked(track: Track): string | null {
  if (!track.available) return "not available";
  if (track.in_library) return "in library";
  return null;
}

export function AlbumPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const storefront = params.get("sf") ?? undefined;
  const navigate = useNavigate();
  const { jobs, notify } = useStore();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setAlbum(null);
    setError("");
    api
      .album(id, storefront)
      .then((loaded) => {
        if (!alive) return;
        setAlbum(loaded);
        // Start with everything that can be downloaded selected: the common
        // case is "the album", and unticking is quicker than ticking.
        setSelected(new Set(loaded.tracks.filter((t) => !blocked(t)).map((t) => t.id)));
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The album could not be loaded."));
    return () => {
      alive = false;
    };
  }, [id, storefront]);

  const selectable = useMemo(() => album?.tracks.filter((t) => !blocked(t)) ?? [], [album]);

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
  if (!album) {
    return (
      <>
        {back}
        <p className="empty">Loading…</p>
      </>
    );
  }

  const unavailable = album.tracks.filter((t) => !t.available).length;
  const owned = album.tracks.filter((t) => t.available && t.in_library).length;
  const everything = selectable.length > 0 && selected.size === selectable.length;
  const wholeAlbum = everything && selectable.length === album.tracks.length;
  const queued = jobs.find((j) => j.apple_id === album.id && (j.status === "queued" || j.status === "running"));
  const quality = qualityLabel(album.traits);

  function toggle(trackId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  async function download() {
    if (!album) return;
    setBusy(true);
    try {
      // The plain album link when nothing was left out; otherwise the
      // chosen songs. Songs Apple does not offer are skipped either way.
      const result = everything && !owned ? await api.addJobs([album.url]) : await api.addJobs([album.url], [...selected]);
      if (result.rejected.length) {
        notify(result.rejected[0].error, "error");
      } else {
        notify(`${album.name}: ${wholeAlbum ? "album" : plural(selected.size, "song")} added to the queue.`, "success");
        navigate("/");
      }
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Could not add that to the queue.", "error");
    } finally {
      setBusy(false);
    }
  }

  const label = selected.size === 0 ? "Select songs to download" : wholeAlbum ? `Download album (${plural(selected.size, "song")})` : `Download ${plural(selected.size, "song")}`;

  return (
    <>
      <div className="section">
        {back}
        <div className="album-head">
          <Cover src={album.artwork} size={160} />
          <div className="album-head-text">
            <h1>{album.name}</h1>
            <p>
              <ArtistNames name={album.artist} artists={album.artists} />
            </p>
            <p className="small muted">{[year(album.release_date), plural(album.tracks.length, "song")].filter(Boolean).join(" · ")}</p>
            <div className="album-tags">
              {quality && <span className={`tag ${quality.startsWith("Hi-Res") ? "tag-accent" : ""}`}>{quality}</span>}
              {album.explicit && <span className="tag tag-ghost">Explicit</span>}
              {album.in_library && (
                <span className="tag tag-ok">
                  <Icon name="check" size={13} /> folder in library
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {unavailable > 0 && (
        <div className="callout callout-warn">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>
            <strong>
              {unavailable} of {plural(album.tracks.length, "song")} {unavailable === 1 ? "is" : "are"} not available on Apple Music.
            </strong>{" "}
            {selectable.length > 0 ? "The others can be downloaded." : "Nothing can be downloaded."}
          </div>
        </div>
      )}
      {selectable.length === 0 && unavailable < album.tracks.length && (
        <div className="callout callout-ok">
          <span className="callout-icon">
            <Icon name="check" size={20} />
          </span>
          <div>Every available song of this album is already in your library.</div>
        </div>
      )}

      <section className="section" aria-labelledby="songs-heading">
        <div className="section-head">
          <h2 id="songs-heading">
            Songs{" "}
            <span className="muted">
              [{selected.size} of {selectable.length} selected]
            </span>
          </h2>
          {selectable.length > 1 && (
            <button
              className="button button-small button-plain"
              onClick={() => setSelected(everything ? new Set() : new Set(selectable.map((t) => t.id)))}
            >
              {everything ? "Select none" : "Select all"}
            </button>
          )}
        </div>
        <ul className="card tracks">
          {album.tracks.map((track) => {
            const reason = blocked(track);
            const checkboxId = `track-${track.id}`;
            return (
              <li key={track.id} className={reason ? "track track-blocked" : "track"}>
                <label htmlFor={checkboxId}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={selected.has(track.id)}
                    disabled={Boolean(reason)}
                    onChange={() => toggle(track.id)}
                  />
                  <span className="track-number" aria-hidden="true">
                    {String(track.track_number).padStart(2, "0")}
                  </span>
                  <span className="track-text">
                    <span className="track-name">{track.name}</span>
                    {track.artist !== album.artist && (
                      <span className="small muted">
                        <ArtistNames name={track.artist} artists={track.artists} />
                      </span>
                    )}
                  </span>
                  {reason ? (
                    <span className={`tag ${track.available ? "tag-ok" : "tag-ghost"}`}>
                      {track.available && <Icon name="check" size={13} />}
                      {reason}
                    </span>
                  ) : (
                    <span className="small muted track-duration">{duration(track.duration_ms)}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="card actionbar">
        <p className="small muted">
          {queued
            ? "This album is already in the queue."
            : owned > 0
              ? `${plural(owned, "song")} already in the library ${owned === 1 ? "is" : "are"} left as ${owned === 1 ? "it is" : "they are"}.`
              : "Songs are stored in the album's folder. Existing files are never replaced."}
        </p>
        <button className="button button-primary" disabled={busy || selected.size === 0 || Boolean(queued)} onClick={download}>
          {selected.size > 0 && <Icon name="download" />} {label}
        </button>
      </div>
    </>
  );
}
