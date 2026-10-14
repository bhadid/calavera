import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigationType, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { GROUP_NAMES } from "../lib/format";
import type { Album, ReleaseGroup } from "../lib/types";
import { AlbumGrid } from "../components/AlbumGrid";
import { BackButton, LoadError } from "../components/BackButton";
import { StaleNote } from "../components/StaleNote";

interface Loaded {
  artist: string;
  items: Album[];
  /** Where the next page starts; null once every page is here. */
  next: number | null;
  /** Releases outside Apple's grouping that belong here; null until known. */
  others: Album[] | null;
  staleSince: number | null;
  scrollY: number;
}

// What each group page has loaded, so that coming back from an album shows
// the same releases at the same place instead of starting over. Gone on reload.
const loaded = new Map<string, Loaded>();

type Shown = ReleaseGroup | "all";
const isGroup = (group: string): group is Shown => group === "all" || group in GROUP_NAMES;
const title = (group: Shown) => (group === "all" ? "All releases" : GROUP_NAMES[group]);

/**
 * All releases of one group of an artist ("See all"), as in Apple's Music
 * app, or every release of the artist newest first ("all"): the next page is
 * fetched as the end of the list comes near. On a group, the releases Apple
 * lists outside its own grouping follow at the end, so that nothing Apple
 * has is hidden; "all" has them anyway and only tags them. Releases that
 * share a title show their label.
 */
export function ArtistGroupPage() {
  const { id = "", group = "" } = useParams();
  const key = `${id}/${group}`;
  const [state, setState] = useState<Loaded>(
    () => loaded.get(key) ?? { artist: "", items: [], next: 0, others: null, staleSince: null, scrollY: 0 },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const current = useRef(state);
  current.current = state;

  // Keep what is loaded, and where the page was scrolled to.
  useEffect(() => {
    loaded.set(key, state);
  }, [key, state]);
  // Read while scrolling: when the page is left, the next one has already
  // replaced it and the browser has moved the scroll position.
  const scrolled = useRef(0);
  useEffect(() => {
    const track = () => void (scrolled.current = window.scrollY);
    window.addEventListener("scroll", track, { passive: true });
    return () => {
      window.removeEventListener("scroll", track);
      loaded.set(key, { ...current.current, scrollY: scrolled.current });
    };
  }, [key]);
  // Back (or forward) returns to the same place; opened anew, the page
  // starts at the top.
  const arrival = useNavigationType();
  useLayoutEffect(() => {
    const kept = loaded.get(key);
    window.scrollTo(0, arrival === "POP" && kept ? kept.scrollY : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The artist's name for the heading: usually remembered from their page.
  useEffect(() => {
    if (state.artist) return;
    api
      .artist(id)
      .then((a) => setState((s) => ({ ...s, artist: a.name })))
      .catch(() => undefined);
  }, [id, state.artist]);

  async function more() {
    const { next } = current.current;
    if (next === null || busy || !isGroup(group)) return;
    setBusy(true);
    try {
      const page = await api.artistGroup(id, group, next);
      setState((s) => {
        const seen = new Set(s.items.map((a) => a.id));
        return {
          ...s,
          items: [...s.items, ...page.items.filter((a) => !seen.has(a.id))],
          next: page.next,
          staleSince: page.stale_since ?? s.staleSince,
        };
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The releases could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  // The first page at once; further ones when the end of the list is near.
  useEffect(() => {
    if (current.current.items.length === 0) void more();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    const el = end.current;
    if (!el || state.next === null || busy) return;
    const watcher = new IntersectionObserver((entries) => entries[0].isIntersecting && void more(), { rootMargin: "800px 0px" });
    watcher.observe(el);
    return () => watcher.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.next, busy, state.items.length]);

  // The releases outside Apple's grouping take a few requests; they are
  // fetched alongside and mixed in by date (see below).
  useEffect(() => {
    if (state.others !== null || !isGroup(group)) return;
    let alive = true;
    api
      .artistOthers(id)
      .then((answer) => alive && setState((s) => ({ ...s, others: answer.items.filter((a) => group === "all" || a.group === group) })))
      .catch(() => alive && setState((s) => ({ ...s, others: [] })));
    return () => {
      alive = false;
    };
  }, [id, group, state.others]);

  // A release outside Apple's grouping joins the list next to the release
  // with its title, or else at its date, but only once the list has loaded
  // down to that date: it then lands below what is being read, and nothing
  // jumps. Releases under the same title (usually of the same date, so they
  // arrive together) show their label to tell them apart.
  const items = useMemo(() => {
    // "All releases" has them already; they only get their tag.
    const outside = new Set(group === "all" ? (state.others ?? []).map((a) => a.id) : []);
    const list = state.items.map((a) => (outside.has(a.id) ? { ...a, other_release: true } : a));
    const reached = state.next === null ? "" : (list[list.length - 1]?.release_date ?? "\uffff");
    for (const other of group === "all" ? [] : (state.others ?? [])) {
      if (other.release_date < reached || list.some((a) => a.id === other.id)) continue;
      const twin = list.findIndex((a) => a.name.toLowerCase() === other.name.toLowerCase());
      const later = list.findIndex((a) => a.release_date < other.release_date);
      const at = twin >= 0 ? twin + 1 : later >= 0 ? later : list.length;
      list.splice(at, 0, { ...other, other_release: true });
    }
    const count = new Map<string, number>();
    for (const a of list) count.set(a.name.toLowerCase(), (count.get(a.name.toLowerCase()) ?? 0) + 1);
    return list.map((a) => ((count.get(a.name.toLowerCase()) ?? 0) > 1 ? { ...a, same_title: true } : a));
  }, [group, state.items, state.next, state.others]);

  if (!isGroup(group)) return <Navigate to={`/artist/${id}`} replace />;
  if (error && state.items.length === 0) return <LoadError message={error} fallback={`/artist/${id}`} />;

  const finished = state.next === null;
  return (
    <>
      <div className="section">
        <BackButton fallback={`/artist/${id}`} />
        <StaleNote since={state.staleSince} />
        <div>
          <h1>{title(group)}</h1>
          {state.artist && (
            <p className="muted">
              <Link to={`/artist/${id}`} className="quiet-link">
                {state.artist}
              </Link>
            </p>
          )}
        </div>
      </div>
      <section className="section" aria-label={title(group)}>
        {items.length > 0 && <AlbumGrid albums={items} artistId={id} />}
        {finished && state.items.length === 0 && <p className="empty">Apple Music lists nothing here.</p>}
        <div ref={end} />
        {!finished && <p className="empty">Loading…</p>}
        {error && state.items.length > 0 && (
          <p className="small muted" role="status">
            {error}{" "}
            <button className="button button-plain button-small" onClick={() => (setError(""), void more())}>
              Try again
            </button>
          </p>
        )}
      </section>
    </>
  );
}
