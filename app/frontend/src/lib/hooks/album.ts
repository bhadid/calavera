import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { plural, qualityLabel, qualityNumbers } from "../format";
import { useStore } from "../store";
import type { AlbumDetail, Destination, Track } from "../types";

/** Why a song cannot be chosen, in words; null if it can. */
// A song "in library" has a file of its name in the album's folder. When the
// folder holds another edition, that file is the other edition's song.
export function blocked(track: Track, otherEdition = false): string | null {
  if (!track.available) return "not available";
  if (track.in_library) return otherEdition ? "other edition" : "in library";
  return null;
}

/** Whether a song can be added to the library (it can always be downloaded when Apple offers it). */
const addable = (track: Track, otherEdition: boolean) => !blocked(track, otherEdition);

/**
 * An album page: the album, which of its songs are chosen, and getting them,
 * into the library or onto this device. One selection serves both: songs the
 * library has already can be ticked for a download to the device, and adding
 * to the library leaves them out.
 */
export function useAlbumPage(id: string, storefront?: string) {
  const navigate = useNavigate();
  const { jobs, notify } = useStore();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const [numbers, setNumbers] = useState("");
  const [otherRelease, setOtherRelease] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setAlbum(null);
    setError("");
    setNumbers("");
    setOtherRelease(false);
    api
      .album(id, storefront)
      .then((loaded) => {
        if (!alive) return;
        setAlbum(loaded);
        // The quality in numbers takes one more download from Apple, so it is
        // asked for after the page is there; without it the label stands alone.
        if (qualityLabel(loaded.traits)) {
          api
            .albumQuality(id, storefront)
            .then(({ quality }) => alive && quality && setNumbers(qualityNumbers(quality)))
            .catch(() => undefined);
        }
        // Whether Apple leaves the album out of its artists' releases takes
        // a few more requests per artist; the label follows when known.
        if (loaded.artists?.length) {
          api
            .albumOtherRelease(id, storefront)
            .then(({ other_release }) => alive && setOtherRelease(other_release))
            .catch(() => undefined);
        }
        // Start with everything that can be downloaded selected: the common
        // case is "the album", and unticking is quicker than ticking.
        setSelected(new Set(loaded.tracks.filter((t) => addable(t, loaded.edition === "other")).map((t) => t.id)));
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The album could not be loaded."));
    return () => {
      alive = false;
    };
  }, [id, storefront]);

  const otherEdition = album?.edition === "other";
  // Every song Apple offers can be chosen.
  const selectable = useMemo(() => album?.tracks.filter((t) => t.available) ?? [], [album]);
  // Of those, what may go into the library. Nothing goes into a folder of
  // another edition, not even the songs it lacks.
  const forLibrary = useMemo(
    () => new Set(selectable.filter((t) => selected.has(t.id) && addable(t, otherEdition)).map((t) => t.id)),
    [selectable, selected, otherEdition],
  );
  const canAdd = selectable.some((t) => addable(t, otherEdition));

  const tracks = album?.tracks ?? [];
  const unavailable = tracks.filter((t) => !t.available).length;
  const owned = tracks.filter((t) => t.available && t.in_library).length;
  const everything = selectable.length > 0 && selected.size === selectable.length;
  const wholeAlbum = everything && selectable.length === tracks.length;
  const libraryWhole = wholeAlbum && forLibrary.size === tracks.length;
  const queuedFor = (destination: Destination) =>
    album
      ? jobs.find(
          (j) =>
            j.apple_id === album.id &&
            (j.status === "queued" || j.status === "running") &&
            (j.options.destination ?? "library") === destination,
        )
      : undefined;
  const queued = queuedFor("library");
  const queuedDevice = queuedFor("device");

  function toggle(trackId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }
  const toggleAll = () => setSelected(everything ? new Set() : new Set(selectable.map((t) => t.id)));

  async function get(destination: Destination) {
    if (!album) return;
    const songs = destination === "library" ? forLibrary : selected;
    const whole = destination === "library" ? libraryWhole && !album.in_library : wholeAlbum;
    setBusy(true);
    try {
      // The plain album link when nothing was left out (and, for the
      // library, the album has no folder yet); otherwise the chosen songs,
      // which may go into an existing folder. Songs Apple does not offer
      // are skipped either way.
      const result = whole
        ? await api.addJobs([album.url], undefined, destination)
        : await api.addJobs([album.url], [...songs], destination);
      if (result.rejected.length) {
        notify(result.rejected[0].error, "error");
      } else {
        const what = whole ? "album" : plural(songs.size, "song");
        notify(
          destination === "device"
            ? `${album.name}: the ${what} will be ready to download in the queue.`
            : `${album.name}: ${what} added to the queue.`,
          "success",
        );
        navigate("/queue");
      }
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Could not add that to the queue.", "error");
    } finally {
      setBusy(false);
    }
  }

  const label =
    forLibrary.size === 0
      ? canAdd ? "Select songs to add" : "Add to library"
      : libraryWhole
        ? "Add album to library"
        : `Add ${plural(forLibrary.size, "song")} to library`;

  return {
    album, error, numbers, otherRelease, selected, toggle, toggleAll, busy, label,
    addToLibrary: () => get("library"), download: () => get("device"),
    otherEdition, selectable, forLibrary, canAdd, unavailable, owned, everything, wholeAlbum, queued, queuedDevice,
  };
}
