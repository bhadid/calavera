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
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  has_files: boolean;
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
