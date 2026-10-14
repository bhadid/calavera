import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { plural } from "../lib/format";
import type { Album, ArtistDetail, ReleaseGroup } from "../lib/types";
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

  const groups = GROUPS.map((group) => ({ ...group, items: artist.albums.filter((a) => (a.group ?? "albums") === group.value) })).filter(
    (group) => group.items.length > 0,
  );
  const singles = groups.filter((group) => group.value === "singles");
  const rest = groups.filter((group) => group.value !== "singles");
  // With singles and anything else, a segmented control switches between
  // the two: an artist with many albums would otherwise bury the singles far
  // down the page. The first tab is named after its first group, usually the
  // albums; compilations, live albums and appearances follow below them.
  const both = singles.length > 0 && rest.length > 0;
  const tabs = both
    ? [
        { value: "albums", name: rest[0].name, count: rest[0].items.length, groups: rest },
        { value: "singles", name: singles[0].name, count: singles[0].items.length, groups: singles },
      ]
    : [];
  const shown = tabs.find((tab) => tab.value === params.get("show")) ?? tabs[0];
  const albumCount = artist.albums.filter((a) => a.group !== "singles").length;
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
                {plural(albumCount, "album")} · {artist.albums.length - albumCount} singles and EPs
              </p>
            )}
            {artist.more && (
              <p className="small muted">Apple Music lists more than these {artist.albums.length}. Search for a title to find the others.</p>
            )}
          </div>
        </div>
      </div>
      {shown ? (
        <>
          <section className="section" aria-label={shown.name}>
            {/* In the grid's section, where a heading would be: closer to the
                cards it switches than to the header. */}
            <Segmented
              label="Releases shown"
              value={shown.value}
              options={tabs.map((tab) => ({ value: tab.value, label: `${tab.name} [${tab.count}]` }))}
              onChange={(show) => setParams({ show }, { replace: true })}
            />
            <AlbumGrid albums={shown.groups[0].items} artistId={artist.id} />
          </section>
          {shown.groups.slice(1).map((group) => (
            <GroupSection key={group.value} group={group} artistId={artist.id} />
          ))}
        </>
      ) : (
        groups.map((group) => <GroupSection key={group.value} group={group} artistId={artist.id} />)
      )}
    </>
  );
}

const GROUPS: { value: ReleaseGroup; name: string }[] = [
  { value: "albums", name: "Albums" },
  { value: "compilations", name: "Compilations" },
  { value: "live", name: "Live albums" },
  { value: "appears_on", name: "Appears on" },
  { value: "singles", name: "Singles and EPs" },
];

function GroupSection({ group, artistId }: { group: { value: string; name: string; items: Album[] }; artistId: string }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>
          {group.name} <span className="muted">[{group.items.length}]</span>
        </h2>
      </div>
      <AlbumGrid albums={group.items} artistId={artistId} />
    </section>
  );
}
