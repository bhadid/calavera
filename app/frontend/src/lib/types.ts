export type JobStatus = "queued" | "running" | "done" | "skipped" | "failed" | "canceled" | "interrupted";

export interface JobResult {
  status: "imported" | "exists" | "failed";
  message: string;
  path: string;
  artist?: string;
  album?: string;
  tracks?: number;
  format?: string;
  quality?: string[];
  /** Tracks on the album in total; 0 when unknown. */
  album_tracks?: number;
  /** Songs of the album Apple does not offer. */
  unavailable?: number;
}

export interface JobOptions {
  /** Only these songs of the album were asked for. */
  track_ids?: string[];
  merge?: boolean;
  resume?: boolean;
}

export interface Job {
  id: string;
  url: string;
  kind: "album" | "song";
  storefront: string;
  apple_id: string;
  title: string;
  artist: string;
  artwork_url: string;
  status: JobStatus;
  stage: string;
  progress: number;
  detail: string;
  error: string;
  result: JobResult[];
  options: JobOptions;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  has_files: boolean;
  /** Finished tracks sitting in staging that could still be imported. */
  staged_tracks: number;
}

export interface LogLine {
  ts: number;
  line: string;
}

export type ServerEvent =
  | { type: "job"; job: Job }
  | { type: "removed"; id: string }
  | { type: "log"; id: string; line: string; ts: number };

export interface LoginState {
  state: "idle" | "running" | "awaiting_2fa" | "succeeded" | "failed";
  message: string;
  twofa_deadline: number | null;
}

export interface WrapperStatus {
  reachable: boolean;
  phase: "unreachable" | "no_session" | "starting" | "running" | "logging_in" | "awaiting_2fa";
  session: boolean;
  ready: boolean;
  regions: string[];
  login: LoginState;
  log_tail: string[];
}

export interface Status {
  version: string;
  wrapper: WrapperStatus;
  library: { ok: boolean; problem: string | null; free_bytes: number | null };
  staging: { free_bytes: number | null };
  storefront: string;
}

export interface Settings {
  flac: boolean;
  max_sample_rate: 44100 | 48000 | 96000 | 192000;
  language: string;
  storefront: string;
  lyrics: boolean;
  cover_size: 1400 | 3000 | 5000;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artwork: string;
  url: string;
  track_count: number;
  release_date: string;
  traits: string[];
  explicit: boolean;
  single: boolean;
  in_library?: string | null;
}

export interface Track extends Song {
  track_number: number;
  disc_number: number;
  /** False for songs Apple lists but does not offer (greyed out in its apps). */
  available: boolean;
  in_library: boolean;
}

export interface AlbumDetail extends Album {
  storefront: string;
  tracks: Track[];
}

export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  artwork: string;
  url: string;
  duration_ms: number;
  traits: string[];
  explicit: boolean;
}

export interface Artist {
  id: string;
  name: string;
  artwork: string;
  url: string;
}

export interface SearchResults {
  albums: Album[];
  songs: Song[];
  artists: Artist[];
}
