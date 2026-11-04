import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import type { SearchResults } from "../types";

/** Words or links typed into the search field that are all Apple Music links. */
export function linksIn(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((w) => /^(https?:\/\/)?music\.apple\.com\//.test(w)) ? words : [];
}

/**
 * The catalogue search. The query lives in the URL so results survive reloads
 * and the back button. Pressing Search asks Apple afresh, also for the same
 * words again; coming back to the page uses what Calavera remembers.
 */
export function useSearch() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [text, setText] = useState(query);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [presses, setPresses] = useState(0);
  const pressed = useRef(false);

  useEffect(() => {
    setText(query);
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    const fresh = pressed.current;
    pressed.current = false;
    api
      .search(query, fresh)
      .then((r) => alive && setResults(r))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "The search failed."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, presses]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    pressed.current = true;
    setPresses((n) => n + 1);
    setParams(text.trim() ? { q: text.trim() } : {});
  }

  function clear() {
    setText("");
    setParams({});
  }

  const empty = Boolean(results && !results.albums.length && !results.songs.length && !results.artists.length);
  return { query, text, setText, results, error, loading, empty, submit, clear };
}
