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

/** One of the artists behind an album or song: enough to link to their page. */
export interface ArtistRef {
  id: string;
  name: string;
}

export interface Job {
  id: string;
  url: string;
  kind: "album" | "song";
  storefront: string;
  apple_id: string;
  title: string;
  artist: string;
  artists: ArtistRef[];
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
  /** The name as Apple prints it, e.g. "A & B"; `artists` are the people in it. */
  artist: string;
  artists: ArtistRef[];
  artwork: string;
  url: string;
  track_count: number;
  release_date: string;
  traits: string[];
  explicit: boolean;
  single: boolean;
  /** The record label, if Apple names one. */
  label?: string;
  /** Outside Apple's grouping: the group the release belongs to. */
  group?: ReleaseGroup;
  /** On an artist page: another release under the same title as one in Apple's own grouping. */
  other_release?: boolean;
  in_library?: string | null;
}

export type ReleaseGroup = "albums" | "singles" | "compilations" | "live" | "appears_on";

export interface Track extends Song {
  track_number: number;
  disc_number: number;
  /** False for songs Apple lists but does not offer (greyed out in its apps). */
  available: boolean;
  in_library: boolean;
}

/** The lossless quality an album is offered in. The two rates differ for a
 *  hi-res album whose exact rate is not known. */
export interface AlbumQuality {
  bit_depth: number;
  sample_rate_min: number;
  sample_rate_max: number;
}

export interface AlbumDetail extends Album {
  /** Set when Apple could not be reached and this is an older answer: when it is from (Unix seconds). */
  stale_since?: number | null;
  storefront: string;
  /** The album's folder in the library, relative to its root: the existing one, or the one a download would create. */
  library_path: string;
  /** Whether the existing folder holds this edition or another one under the
   *  same title, going by the barcode in its files; null when unknown. */
  edition?: "same" | "other" | null;
  tracks: Track[];
}

export interface Song {
  id: string;
  name: string;
  artist: string;
  artists: ArtistRef[];
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

/** The first releases of one group on an artist page. */
export interface Shelf {
  group: ReleaseGroup;
  items: Album[];
  /** The group has more releases than these. */
  more: boolean;
}

export interface ArtistDetail extends Artist {
  /** Set when Apple could not be reached and this is an older answer: when it is from (Unix seconds). */
  stale_since?: number | null;
  shelves: Shelf[];
}

/** One page of an artist's group. */
export interface GroupPage {
  stale_since?: number | null;
  items: Album[];
  /** Where the following page starts, or null after the last one. */
  next: number | null;
}

/** Releases Apple lists for an artist outside its own grouping, each with its `group`. */
export interface OtherReleases {
  stale_since?: number | null;
  items: Album[];
}

export interface SearchResults {
  /** Set when Apple could not be reached and this is an older answer: when it is from (Unix seconds). */
  stale_since?: number | null;
  albums: Album[];
  songs: Song[];
  artists: Artist[];
}
