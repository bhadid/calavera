import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Album } from "../lib/types";
import { AlbumCard } from "./AlbumGrid";
import { Icon } from "./Icon";

/**
 * One row of albums that scrolls sideways, as on an artist page in Apple's
 * Music app: the title and "See all" lead to the whole group. Phones swipe;
 * with a mouse, the arrow buttons scroll by a screenful.
 */
export function Shelf({ title, to, albums, artistId }: { title: string; to: string; albums: Album[]; artistId: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  function measure() {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [albums]);

  function scroll(direction: 1 | -1) {
    const el = row.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: "smooth" });
  }

  return (
    <section className="section shelf">
      <div className="section-head">
        <h2>
          <Link to={to} className="quiet-link">
            {title}
          </Link>
        </h2>
        <div className="shelf-actions">
          {!(edges.start && edges.end) && (
            <span className="shelf-arrows">
              <button className="button button-plain button-icon" aria-label="Scroll back" disabled={edges.start} onClick={() => scroll(-1)}>
                <Icon name="previous" />
              </button>
              <button className="button button-plain button-icon" aria-label="Scroll on" disabled={edges.end} onClick={() => scroll(1)}>
                <Icon name="next" />
              </button>
            </span>
          )}
          <Link to={to} className="see-all">
            See all
          </Link>
        </div>
      </div>
      <div className="shelf-row" ref={row} onScroll={measure}>
        {albums.map((album) => (
          <AlbumCard key={album.id} album={album} artistId={artistId} />
        ))}
      </div>
    </section>
  );
}
