import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { atTime, duration, plural, year } from "../../lib/format";
import { blocked, useAlbumPage } from "../../lib/hooks/album";
import { ArtistNames } from "../../components/ArtistNames";
import { CoverViewer } from "../../components/CoverViewer";
import { type AlbumLinkState, OtherReleasePill, QualityPill } from "../components/AlbumTile";
import { Icon } from "../components/Icon";
import { BackBar } from "../components/Layout";
import { Notice, span, tint } from "../components/tiles";

export function AlbumPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const storefront = params.get("sf") ?? undefined;
  // Opened from a tile marked as an "other release"; see AlbumTile.
  const otherRelease = Boolean((useLocation().state as AlbumLinkState | null)?.otherRelease);
  const {
    album, error, numbers, selected, toggle, toggleAll, busy, download, label,
    otherEdition, selectable, unavailable, owned, everything, queued,
  } = useAlbumPage(id, storefront);

  if (error) {
    return (
      <div className="page">
        <BackBar />
        <Notice tone="bad" role="alert">{error}</Notice>
      </div>
    );
  }
  if (!album) {
    return (
      <div className="page">
        <BackBar />
        <p className="empty">Loading…</p>
      </div>
    );
  }

  const { className, style } = tint(album.colors);
  const total = album.tracks.reduce((n, t) => n + t.duration_ms, 0);
  // Only a library state worth knowing gets a label; "not there yet" is the usual case.
  const libraryPill = !album.in_library ? null : otherEdition ? (
    <span className="pill pill-bad">Other edition in library</span>
  ) : selectable.length === 0 ? (
    <span className="pill pill-ok">
      <Icon name="check" size={12} weight={3} />
      In library
    </span>
  ) : owned > 0 ? (
    <span className="pill pill-ok">{owned} of {album.tracks.length} in library</span>
  ) : null;

  return (
    <div className="page">
      <BackBar />
      {album.stale_since && (
        <div className="notices">
          <Notice tone="warn" role="status">
            Apple Music can't be reached right now. Showing what was loaded {atTime(album.stale_since)}.
          </Notice>
        </div>
      )}
      <div className="bento">
        <section className={`tile hero${className}`} style={{ ...span(2, 4, 6), ...style }}>
          <div className="cover-wrap">
            <CoverViewer album={album} size={260} />
          </div>
          <div className="text">
            <p className="tile-head">{album.single ? "Single" : "Album"}</p>
            <h1>{album.name}</h1>
            <p className="artist">
              <ArtistNames name={album.artist} artists={album.artists} />
            </p>
            <p className="muted num">
              {[year(album.release_date), plural(album.tracks.length, "song"), `${Math.round(total / 60000)} min`, album.label]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="pills" style={{ marginTop: 4 }}>
              <QualityPill traits={album.traits} />
              {/* The numbers arrive later; nothing moves when they do. */}
              {numbers && <span className="pill num">{numbers}</span>}
              {libraryPill}
              {otherRelease && <OtherReleasePill />}
              {album.explicit && <span className="pill">Explicit</span>}
            </div>
          </div>
        </section>

      </div>

      {(unavailable > 0 || otherEdition || (!otherEdition && selectable.length === 0 && unavailable < album.tracks.length)) && (
        <div className="notices">
          {unavailable > 0 && (
            <Notice tone="warn">
              <strong>
                {unavailable} of {plural(album.tracks.length, "song")} {unavailable === 1 ? "is" : "are"} not available on Apple Music.
              </strong>{" "}
              {selectable.length > 0 ? "The others can be downloaded." : "Nothing can be downloaded."}
            </Notice>
          )}
          {otherEdition && (
            <Notice tone="warn">
              <strong>Your folder {album.in_library}/ holds a different edition of this album.</strong> Its files carry another barcode,
              for example the explicit version instead of the clean one. Calavera does not add songs to it, so that the two editions do
              not get mixed.
            </Notice>
          )}
          {!otherEdition && selectable.length === 0 && unavailable < album.tracks.length && (
            <Notice tone="ok">Every available song of this album is already in your library.</Notice>
          )}
        </div>
      )}

      <div className="bento">
        <section className="tile" style={span(2, 4, 6)} aria-labelledby="songs-heading">
          <div className="tile-bar">
            <h2 id="songs-heading">
              Songs{" "}
              <span className="muted">
                {selected.size} of {selectable.length} selected
              </span>
            </h2>
            {selectable.length > 1 && (
              <button className="btn btn-plain btn-small" onClick={toggleAll}>
                {everything ? "Select none" : "Select all"}
              </button>
            )}
          </div>
          <ul className="list tracks">
            {album.tracks.map((track) => {
              const reason = blocked(track, otherEdition);
              const checkboxId = `track-${track.id}`;
              return (
                <li key={track.id} className={`row-group track${reason ? " track-blocked" : ""}`}>
                  <label className="row" htmlFor={checkboxId} style={{ minHeight: 52 }}>
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={selected.has(track.id)}
                      disabled={Boolean(reason) || otherEdition}
                      onChange={() => toggle(track.id)}
                    />
                    <span className="check" aria-hidden="true">
                      <Icon name="check" size={14} weight={3} />
                    </span>
                    <span className="track-no num" aria-hidden="true">
                      {track.track_number}
                    </span>
                    <span className="row-text">
                      <strong>{track.name}</strong>
                      {track.artist !== album.artist && (
                        <span>
                          <ArtistNames name={track.artist} artists={track.artists} />
                        </span>
                      )}
                    </span>
                    {reason ? (
                      <span className={`row-end ${!track.available ? "" : otherEdition ? "warn" : "ok"}`}>
                        {track.available && !otherEdition && <Icon name="check" size={15} weight={2.6} />}
                        {reason === "in library" ? "In library" : reason === "other edition" ? "Other edition" : "Not available"}
                      </span>
                    ) : (
                      <span className="row-end num">{duration(track.duration_ms)}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="actionbar">
        <p>
          {queued ? (
            "This album is already in the queue."
          ) : (
            <>
              {!album.in_library ? "Saves to " : otherEdition ? "Another edition is at " : selectable.length > 0 ? "Adds to " : "In the library at "}
              <span className="path">{album.library_path}/</span>
              {owned > 0 && selectable.length > 0 && ` · ${plural(owned, "song")} already there ${owned === 1 ? "stays as it is" : "stay as they are"}.`}
              {" "}Existing files are never replaced.
            </>
          )}
        </p>
        <button className="btn btn-filled" disabled={busy || selected.size === 0 || Boolean(queued)} onClick={download}>
          {selected.size > 0 && <Icon name="download" size={19} weight={2.2} />}
          {queued ? "In the queue" : label}
        </button>
      </div>
    </div>
  );
}
