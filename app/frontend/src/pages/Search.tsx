import { useState } from "react";
import { Link } from "react-router-dom";
import { duration, plural, songAlbumPath, year } from "../lib/format";
import { useAddLinks } from "../lib/hooks/addLinks";
import { linksIn, useSearch } from "../lib/hooks/search";
import type { Album, SearchResults } from "../lib/types";
import { ArtistNames } from "../components/ArtistNames";
import { AlbumTile, kindOf, QualityPill, QueueButton, shortName } from "../components/AlbumTile";
import { Icon } from "../components/Icon";
import { Cover, Notice, span, tint } from "../components/tiles";
import { albumPath, atTime } from "../lib/format";

/**
 * Search: the catalogue by words or one link, or several pasted links at
 * once, which then go to the queue together.
 */
export function SearchPage() {
  const { query, text, setText, results, error, loading, empty, submit, clear } = useSearch();
  const { add, rejected, setRejected, submitting } = useAddLinks();
  const links = linksIn(text);

  async function addLinks() {
    const refused = await add(links);
    setText(refused.join("\n"));
  }

  return (
    <div className="page">
      <header className="top">
        <h1>Search</h1>
      </header>
      <form
        className="searchbar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (links.length) void addLinks();
          else submit();
        }}
      >
        <div className="searchfield">
          <Icon name="search" size={19} />
          <input
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRejected([]);
            }}
            onPaste={(e) => {
              // Several links pasted on separate lines arrive as one line in a
              // single-line field; keep them apart.
              const pasted = e.clipboardData.getData("text");
              if (/\n/.test(pasted.trim())) {
                e.preventDefault();
                setText((text ? `${text} ` : "") + pasted.trim().split(/\s+/).join(" "));
              }
            }}
            placeholder="Artists, albums, songs or links"
            aria-label="Search the Apple Music catalogue, or paste links"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            autoFocus
          />
          {text && (
            <button type="button" className="clear" onClick={clear} aria-label="Clear">
              <Icon name="clear" size={18} />
            </button>
          )}
        </div>
      </form>

      {links.length > 0 && (
        <div className="bento">
          <section className="tile" style={span(2, 4, 6)} aria-labelledby="links-heading">
            <div className="tile-head" id="links-heading">
              <Icon name="link" size={16} />
              {links.length} Apple Music links
            </div>
            <p className="muted">Albums and songs from these links go to the queue together.</p>
            <div className="actions">
              <button className="btn btn-filled" disabled={submitting} onClick={addLinks}>
                <Icon name="download" size={19} weight={2.2} />
                Add {links.length} to the queue
              </button>
            </div>
          </section>
        </div>
      )}
      {rejected.length > 0 && (
        <div className="notices">
          <Notice tone="bad" role="alert">
            <strong>{rejected.length === 1 ? "One link was not added." : `${rejected.length} links were not added.`}</strong>
            <ul>
              {rejected.map((r) => (
                <li key={r.url} className="path">
                  {r.error} <span className="muted">{r.url}</span>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {error && (
        <div className="notices">
          <Notice tone="bad" role="alert">
            {error}
          </Notice>
        </div>
      )}
      {!loading && results?.stale_since && (
        <div className="notices">
          <Notice tone="warn" role="status">
            Apple Music can't be reached right now. Showing what was found {atTime(results.stale_since)}.
          </Notice>
        </div>
      )}
      {loading && <p className="empty">Searching…</p>}
      {!loading && !error && !results && !links.length && <p className="empty">Find albums and songs in the Apple Music catalogue, or paste one or more links.</p>}
      {!loading && empty && <p className="empty">Nothing found for “{query}”.</p>}
      {!loading && results && !empty && <Results results={results} />}
    </div>
  );
}

/** The best match: the album whose name or artist is closest to the words. */
function topAlbum(results: SearchResults): Album | undefined {
  return [...results.albums].sort((a, b) => Number(kindOf(a) !== "Album") - Number(kindOf(b) !== "Album"))[0];
}

function Results({ results }: { results: SearchResults }) {
  const [allSongs, setAllSongs] = useState(false);
  const top = topAlbum(results);
  const others = results.albums.filter((a) => a !== top);
  const songs = allSongs ? results.songs : results.songs.slice(0, 4);
  return (
    <>
      <div className="bento">
        {top && <TopResult album={top} />}
        {results.songs.length > 0 && (
          <section className="tile" style={span(2, 4, top ? 3 : 6, 1, 2, 2)} aria-labelledby="songs-heading">
            <div className="tile-bar">
              <h2 id="songs-heading">Songs</h2>
              {results.songs.length > 4 && (
                <button className="btn btn-plain btn-small" onClick={() => setAllSongs(!allSongs)}>
                  {allSongs ? "Fewer" : "See all"}
                </button>
              )}
            </div>
            <div className="list">
              {songs.map((song) => {
                const albumPage = songAlbumPath(song.url);
                return (
                  <div key={song.id} className="row">
                    <Cover src={song.artwork} className="cover-sm" />
                    <div className="row-text">
                      <strong title={song.name}>{song.name}</strong>
                      <span>
                        <ArtistNames name={song.artist} artists={song.artists} /> ·{" "}
                        {albumPage ? (
                          <Link to={albumPage} className="quiet-link">
                            {song.album}
                          </Link>
                        ) : (
                          song.album
                        )}
                        {" · "}
                        {duration(song.duration_ms)}
                      </span>
                    </div>
                    <QueueButton url={song.url} appleId={song.id} inLibrary={song.in_library} compact label={`Download ${song.name}`} />
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {results.artists.length > 0 && (
        <>
          <h2 className="section-title">Artists</h2>
          <div className="artist-strip">
            {results.artists.slice(0, 12).map((a) => (
              <Link key={a.id} to={`/artist/${a.id}`}>
                <Cover src={a.artwork} round />
                <span>{a.name}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      {others.length > 0 && (
        <>
          <h2 className="section-title">Albums</h2>
          <div className="bento-cards">
            {others.map((album) => (
              <AlbumTile key={album.id} album={album} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function TopResult({ album }: { album: Album }) {
  const { className, style } = tint(album.colors);
  const to = albumPath(album.url) ?? `/album/${album.id}`;
  return (
    <section className={`tile${className}`} style={{ ...span(2, 4, 3, 1, 2, 2), ...style }} aria-labelledby="top-heading">
      <div className="tile-head" id="top-heading">
        Top result
      </div>
      <div className="top-result">
        <Link to={to} tabIndex={-1} aria-hidden="true">
          <Cover src={album.artwork} />
        </Link>
        <div className="text">
          <Link to={to} className="big">
            {shortName(album.name)}
          </Link>
          <p className="muted">
            {kindOf(album)} · <ArtistNames name={album.artist} artists={album.artists} /> · {year(album.release_date)}
          </p>
          <div className="pills">
            <QualityPill traits={album.traits} />
            <span className="pill">{plural(album.track_count, "song")}</span>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <QueueButton url={album.url} appleId={album.id} inLibrary={album.in_library} />
            <Link className="btn btn-gray btn-small" to={to}>
              Choose songs
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
