import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { duration } from "../lib/format";
import type { SearchResults } from "../lib/types";
import { AlbumGrid, QueueButton } from "../components/AlbumGrid";
import { ArtistNames } from "../components/ArtistNames";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";

export function SearchPage() {
  // The query lives in the URL so results survive reloads and the back button.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [text, setText] = useState(query);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setText(query);
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    api
      .search(query)
      .then((r) => alive && setResults(r))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The search failed."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setParams(text.trim() ? { q: text.trim() } : {});
  }

  const empty = results && !results.albums.length && !results.songs.length && !results.artists.length;
  return (
    <>
      <div className="page-head">
        <h1>
          <span className="prompt" aria-hidden="true">
          ❯
        </span>
          Search
        </h1>
      </div>

      <form className="searchbar" onSubmit={submit} role="search">
        <div className="prompt-field">
          <span className="prompt" aria-hidden="true">
            /
          </span>
          <input
            className="input"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="artist, album, song or link"
            aria-label="Search the Apple Music catalogue"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            autoFocus
          />
        </div>
        <button className="button button-primary" disabled={loading} aria-label="Search">
          <Icon name="search" size={18} />
          <span className="label">Search</span>
        </button>
      </form>

      {error && (
        <div className="callout callout-bad" role="alert">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>{error}</div>
        </div>
      )}
      {loading && <p className="empty">Searching…</p>}
      {!loading && !error && !results && <p className="empty">Search the Apple Music catalogue to queue albums and songs.</p>}
      {!loading && empty && <p className="empty">Nothing found for “{query}”.</p>}

      {!loading && results && results.artists.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>
              Artists <span className="muted">[{results.artists.length}]</span>
            </h2>
          </div>
          <div className="chips">
            {results.artists.slice(0, 8).map((artist) => (
              <Link key={artist.id} to={`/artist/${artist.id}`} className="chip">
                <Cover src={artist.artwork} size={36} round />
                {artist.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && results && results.albums.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>
              Albums <span className="muted">[{results.albums.length}]</span>
            </h2>
          </div>
          <AlbumGrid albums={results.albums} />
        </section>
      )}

      {!loading && results && results.songs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>
              Songs <span className="muted">[{results.songs.length}]</span>
            </h2>
          </div>
          <div className="card rows">
            {results.songs.map((song, index) => (
              <div key={song.id} className="row">
                <span className="row-index small row-meta" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Cover src={song.artwork} size={44} />
                <div className="row-text">
                  <strong title={song.name}>{song.name}</strong>
                  <span className="muted small">
                    <ArtistNames name={song.artist} artists={song.artists} /> · {song.album}
                  </span>
                </div>
                <span className="muted small row-meta">{duration(song.duration_ms)}</span>
                <QueueButton url={song.url} appleId={song.id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
