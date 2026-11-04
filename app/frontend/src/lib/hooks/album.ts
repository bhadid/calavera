import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { plural, qualityLabel, qualityNumbers } from "../format";
import { useStore } from "../store";
import type { AlbumDetail, Track } from "../types";

/** Why a song cannot be chosen, in words; null if it can. */
// A song "in library" has a file of its name in the album's folder. When the
// folder holds another edition, that file is the other edition's song.
export function blocked(track: Track, otherEdition = false): string | null {
  if (!track.available) return "not available";
  if (track.in_library) return otherEdition ? "other edition" : "in library";
  return null;
}

/** An album page: the album, which of its songs are chosen, and downloading them. */
export function useAlbumPage(id: string, storefront?: string) {
  const navigate = useNavigate();
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
        // asked for after the page is there; without it the label stands alone.
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

  const tracks = album?.tracks ?? [];
  const unavailable = tracks.filter((t) => !t.available).length;
  const owned = tracks.filter((t) => t.available && t.in_library).length;
  const everything = selectable.length > 0 && selected.size === selectable.length;
  const wholeAlbum = everything && selectable.length === tracks.length;
  const queued = album ? jobs.find((j) => j.apple_id === album.id && (j.status === "queued" || j.status === "running")) : undefined;

  function toggle(trackId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }
  const toggleAll = () => setSelected(everything ? new Set() : new Set(selectable.map((t) => t.id)));

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
        navigate("/queue");
      }
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Could not add that to the queue.", "error");
    } finally {
      setBusy(false);
    }
  }

  const label =
    selected.size === 0
      ? "Select songs to download"
      : wholeAlbum
        ? `Download album (${plural(selected.size, "song")})`
        : `Download ${plural(selected.size, "song")}`;

  return {
    album, error, numbers, selected, toggle, toggleAll, busy, download, label,
    otherEdition, selectable, unavailable, owned, everything, wholeAlbum, queued,
  };
}
