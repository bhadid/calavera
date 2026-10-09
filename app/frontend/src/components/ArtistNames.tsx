import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ArtistRef } from "../lib/types";

/**
 * An artist line such as "A & B" with each artist linked to their page; the
 * words between the names stay text. `except` is an artist not to link: the
 * one whose page this is.
 */
export function ArtistNames({ name, artists = [], except }: { name: string; artists?: ArtistRef[]; except?: string }) {
  const link = (artist: ArtistRef, text: string) =>
    artist.id === except ? (
      text
    ) : (
      <Link to={`/artist/${artist.id}`} className="quiet-link">
        {text}
      </Link>
    );

  // Where each artist's name stands in the line, left to right.
  const found = artists
    .map((artist) => ({ artist, at: name.indexOf(artist.name) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at);
  // Apple sometimes prints a name differently than the artist is called.
  if (!found.length) return <>{artists.length === 1 ? link(artists[0], name) : name}</>;

  const parts: ReactNode[] = [];
  let end = 0;
  for (const { artist, at } of found) {
    if (at < end) continue; // overlaps the name before it
    parts.push(name.slice(end, at), link(artist, artist.name));
    end = at + artist.name.length;
  }
  parts.push(name.slice(end));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
