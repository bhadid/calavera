import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { duration, plural, qualityLabel, year } from "../lib/format";
import { blocked, useAlbumPage } from "../lib/hooks/album";
import { type AlbumLinkState, OtherReleaseTag } from "../components/AlbumGrid";
import { ArtistNames } from "../components/ArtistNames";
import { CoverViewer } from "../components/CoverViewer";
import { Icon } from "../components/Icon";
import { StaleNote } from "../components/StaleNote";

export function AlbumPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const storefront = params.get("sf") ?? undefined;
  const navigate = useNavigate();
  // Opened from a card marked as an "other release"; see AlbumCard.
  const otherRelease = Boolean((useLocation().state as AlbumLinkState | null)?.otherRelease);
  const {
    album, error, numbers, selected, toggle, toggleAll, busy, download, label,
    otherEdition, selectable, unavailable, owned, everything, queued,
  } = useAlbumPage(id, storefront);

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

  const quality = qualityLabel(album.traits);

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
              onClick={toggleAll}
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
