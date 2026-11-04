import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { ArtistDetail } from "../types";

/** An artist page: one request for the first releases of each group. */
export function useArtist(id: string) {
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState("");
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
  return { artist, error };
}
