import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { duration, plural, qualityLabel, qualityNumbers, year } from "../lib/format";
import { useStore } from "../lib/store";
import type { AlbumDetail, Track } from "../lib/types";
import { type AlbumLinkState, OtherReleaseTag } from "../components/AlbumGrid";
import { ArtistNames } from "../components/ArtistNames";
import { CoverViewer } from "../components/CoverViewer";
import { Icon } from "../components/Icon";
import { StaleNote } from "../components/StaleNote";

/** Why a song cannot be chosen, in words; null if it can. */
// A song "in library" has a file of its name in the album's folder. When the
// folder holds another edition, that file is the other edition's song.
function blocked(track: Track, otherEdition = false): string | null {
  if (!track.available) return "not available";
  if (track.in_library) return otherEdition ? "other edition" : "in library";
  return null;
}

export function AlbumPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const storefront = params.get("sf") ?? undefined;
  const navigate = useNavigate();
  // Opened from a card marked as an "other release"; see AlbumCard.
  const otherRelease = Boolean((useLocation().state as AlbumLinkState | null)?.otherRelease);
  const { jobs, notify } = useStore();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const [numbers, setNumbers] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setAlbum(null);
    setError("");
    setNumbers("");
    api
      .album(id, storefront)
      .then((loaded) => {
        if (!alive) return;
        setAlbum(loaded);
        // The quality in numbers takes one more download from Apple, so it is
        // asked for after the page is there; without it the tag stands alone.
        if (qualityLabel(loaded.traits)) {
          api
            .albumQuality(id, storefront)
            .then(({ quality }) => alive && quality && setNumbers(qualityNumbers(quality)))
            .catch(() => undefined);
        }
        // Start with everything that can be downloaded selected: the common
        // case is "the album", and unticking is quicker than ticking.
        setSelected(new Set(loaded.edition === "other" ? [] : loaded.tracks.filter((t) => !blocked(t)).map((t) => t.id)));
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The album could not be loaded."));
    return () => {
      alive = false;
    };
  }, [id, storefront]);

  const otherEdition = album?.edition === "other";
  // Nothing goes into a folder of another edition, not even the songs it lacks.
  const selectable = useMemo(
    () => (otherEdition ? [] : (album?.tracks.filter((t) => !blocked(t)) ?? [])),
    [album, otherEdition],
  );

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
      // The plain album link when nothing was left out and the album has no
      // folder yet; otherwise the chosen songs, which may go into an existing
      // folder. Songs Apple does not offer are skipped either way.
      const result = everything && !album.in_library ? await api.addJobs([album.url]) : await api.addJobs([album.url], [...selected]);
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
        <StaleNote since={album.stale_since} />
        <div className="album-head">
          <CoverViewer album={album} size={160} />
          <div className="album-head-text">
            <h1>{album.name}</h1>
            <p>
              <ArtistNames name={album.artist} artists={album.artists} />
            </p>
            {/* The numbers come last: they arrive later, and nothing should move when they do. */}
            <p className="small muted">
              {[year(album.release_date), plural(album.tracks.length, "song"), album.label, numbers].filter(Boolean).join(" · ")}
            </p>
            <div className="album-tags">
              {quality && <span className={`tag ${quality.startsWith("Hi-Res") ? "tag-accent" : ""}`}>{quality}</span>}
              {otherRelease && <OtherReleaseTag />}
              {album.explicit && <span className="tag tag-ghost">Explicit</span>}
              {album.in_library &&
                (otherEdition ? (
                  <span className="tag tag-warn">other edition in library</span>
                ) : (
                  <span className="tag tag-ok">
                    <Icon name="check" size={13} /> folder in library
                  </span>
                ))}
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
      {otherEdition && (
        <div className="callout callout-warn">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>
            <strong>Your folder {album.in_library}/ holds a different edition of this album.</strong> Its files carry
            another barcode, for example the explicit version instead of the clean one. Calavera does not add songs
            to it, so that the two editions do not get mixed.
          </div>
        </div>
      )}
      {!otherEdition && selectable.length === 0 && unavailable < album.tracks.length && (
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
            const reason = blocked(track, otherEdition);
            const checkboxId = `track-${track.id}`;
            return (
              <li key={track.id} className={reason ? "track track-blocked" : "track"}>
                <label htmlFor={checkboxId}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={selected.has(track.id)}
                    disabled={Boolean(reason) || otherEdition}
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
                    <span className={`tag ${!track.available ? "tag-ghost" : otherEdition ? "tag-warn" : "tag-ok"}`}>
                      {track.available && !otherEdition && <Icon name="check" size={13} />}
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
            : (
              <>
                {!album.in_library
                  ? "Saves to "
                  : otherEdition
                    ? "Another edition is at "
                    : selectable.length > 0
                      ? "Adds to "
                      : "In the library at "}
                <span className="path">{album.library_path}/</span>
                {owned > 0 && selectable.length > 0 &&
                  ` · ${plural(owned, "song")} already there ${owned === 1 ? "stays as it is" : "stay as they are"}.`}
              </>
            )}
        </p>
        <button className="button button-primary" disabled={busy || selected.size === 0 || Boolean(queued)} onClick={download}>
          {selected.size > 0 && <Icon name="download" />} {label}
        </button>
      </div>
    </>
  );
}
