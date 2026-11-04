import { useId, useRef } from "react";
import { Link } from "react-router-dom";
import { albumPath, qualityLabel, year } from "../../lib/format";
import { useQueueItem } from "../../lib/hooks/queueItem";
import type { Album } from "../../lib/types";
import { Icon } from "./Icon";
import { Cover } from "./tiles";

/** What a tile tells the album page it opens. */
export interface AlbumLinkState {
  otherRelease?: boolean;
}

/** Queues an item, or shows that it is queued, downloading or owned. */
export function QueueButton({ url, appleId, inLibrary, label = "Download", compact = false }: {
  url: string; appleId: string; inLibrary?: string | null; label?: string; compact?: boolean;
}) {
  const { state, busy, add } = useQueueItem(url, appleId, inLibrary);
  if (state === "queued" || state === "running") {
    return (
      <span className="owned owned-wait">
        <Icon name="clock" size={16} />
        {compact ? <span className="sr-only">{state === "running" ? "Downloading" : "Queued"}</span> : state === "running" ? "Downloading" : "Queued"}
      </span>
    );
  }
  if (state === "owned") {
    return (
      <span className="owned" title={inLibrary ?? undefined}>
        <Icon name="check" size={17} weight={2.6} />
        {compact ? <span className="sr-only">In library</span> : "In library"}
      </span>
    );
  }
  return (
    <button className={`btn btn-tinted btn-small${compact ? " btn-icon" : ""}`} disabled={busy} onClick={add} aria-label={compact ? label : undefined}>
      <Icon name="download" size={17} weight={2.2} />
      {!compact && label}
    </button>
  );
}

/** "Single", "EP" or "Album", from the title Apple gives it. */
export function kindOf(album: Album): string {
  if (album.name.endsWith(" - EP")) return "EP";
  if (album.single || album.name.endsWith(" - Single")) return "Single";
  return "Album";
}
export const shortName = (name: string) => name.replace(/ - (Single|EP)$/, "");

export function QualityPill({ traits }: { traits: string[] }) {
  const quality = qualityLabel(traits);
  if (!quality) return null;
  return <span className={`pill${quality.startsWith("Hi-Res") ? " pill-accent" : ""}`}>{quality}</span>;
}

/** An album as a small tile: cover and title open its page, where songs can be chosen. */
export function AlbumTile({ album, showArtist = true }: { album: Album; showArtist?: boolean }) {
  const to = albumPath(album.url) ?? `/album/${album.id}`;
  // The album page cannot tell an "other release" by itself; it is told.
  const state: AlbumLinkState | undefined = album.other_release ? { otherRelease: true } : undefined;
  return (
    <article className="tile album-tile">
      <Link to={to} state={state} className="cover-link" aria-label={`${album.name}: show songs`}>
        <Cover src={album.artwork} />
      </Link>
      <h3 title={album.name}>
        <Link to={to} state={state}>
          {shortName(album.name)}
        </Link>
      </h3>
      <p className="facts" title={album.artist}>
        {[showArtist ? album.artist : kindOf(album), year(album.release_date)].filter(Boolean).join(" · ")}
      </p>
      <div className="pills">
        <QualityPill traits={album.traits} />
        {album.other_release && <OtherReleasePill />}
        {album.explicit && (
          <span className="pill" title="Explicit">
            E<span className="sr-only">xplicit</span>
          </span>
        )}
      </div>
      <div className="act">
        <QueueButton url={album.url} appleId={album.id} inLibrary={album.in_library} />
      </div>
    </article>
  );
}

// React 18 does not know the popover attribute yet; it is passed through as is.
const POPOVER = { popover: "auto" } as Record<string, string>;

/** Marks a release Apple's grouping leaves out; tapping it says why. */
export function OtherReleasePill() {
  const id = useId();
  const card = useRef<HTMLDivElement>(null);
  const explanation =
    "Apple Music lists this release too, but leaves it out of its own grouping of the artist's releases, usually because " +
    "another release has the same title. It can be a different version, such as a radio edit.";
  return (
    <>
      <button type="button" className="pill" aria-controls={id} title={explanation} onClick={() => card.current?.togglePopover?.()}>
        Other release <Icon name="info" size={12} />
      </button>
      <div id={id} ref={card} className="popover" role="note" {...POPOVER}>
        {explanation}
      </div>
    </>
  );
}
