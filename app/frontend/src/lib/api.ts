import type { AlbumDetail, AlbumQuality, ArtistDetail, Job, LogLine, SearchResults, Settings, Status } from "./types";

/** An error whose message is safe to show to the user. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Calavera could not be reached. Is it still running?", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data && typeof data.error === "string" && data.error) || `Request failed (${response.status}).`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

// Reloading a page is a request for the latest: the catalogue calls of the
// reloaded page ask Apple afresh instead of using Calavera's short memory.
// It ends with the first move to another page (see Layout).
let reloaded = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload";

export function leftReloadedPage(): void {
  reloaded = false;
}

/** The query string of a catalogue call. `fresh` asks Apple even if the answer is remembered. */
function query(params: Record<string, string | undefined>, fresh?: boolean): string {
  const all = { ...params, fresh: fresh || reloaded ? "1" : undefined };
  const pairs = Object.entries(all).filter((pair): pair is [string, string] => Boolean(pair[1]));
  return pairs.length ? `?${new URLSearchParams(pairs)}` : "";
}

export interface AddJobsResponse {
  added: Job[];
  rejected: { url: string; error: string }[];
}

export const api = {
  status: () => request<Status>("GET", "/status"),

  jobs: () => request<{ jobs: Job[] }>("GET", "/jobs").then((r) => r.jobs),
  job: (id: string) => request<{ job: Job; log: LogLine[] }>("GET", `/jobs/${id}`),
  /**
   * Queue links. `trackIds` (for a single album link) limits the job to
   * those songs. Resolves with both lists even when every link was rejected.
   */
  addJobs: async (urls: string[], trackIds?: string[]): Promise<AddJobsResponse> => {
    const body = trackIds ? { items: urls.map((url) => ({ url, track_ids: trackIds })) } : { urls };
    try {
      return await request<AddJobsResponse>("POST", "/jobs", body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.body && typeof e.body === "object" && "rejected" in e.body) {
        return e.body as AddJobsResponse;
      }
      throw e;
    }
  },
  cancelJob: (id: string) => request<unknown>("POST", `/jobs/${id}/cancel`),
  retryJob: (id: string) => request<unknown>("POST", `/jobs/${id}/retry`),
  /** Import what the job has or can still get, adding to an existing album folder. */
  importJob: (id: string) => request<unknown>("POST", `/jobs/${id}/import`),
  discardFiles: (id: string) => request<unknown>("DELETE", `/jobs/${id}/files`),
  removeJob: (id: string) => request<unknown>("DELETE", `/jobs/${id}`),

  settings: () => request<{ settings: Settings; defaults: Settings }>("GET", "/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request<{ settings: Settings }>("PUT", "/settings", settings).then((r) => r.settings),

  login: (email: string, password: string) => request<unknown>("POST", "/account/login", { email, password }),
  submitCode: (code: string) => request<unknown>("POST", "/account/code", { code }),

  search: (q: string, fresh?: boolean) => request<SearchResults>("GET", `/catalog/search${query({ q }, fresh)}`),
  album: (id: string, storefront?: string) =>
    request<AlbumDetail>("GET", `/catalog/albums/${encodeURIComponent(id)}${query({ sf: storefront })}`),
  albumQuality: (id: string, storefront?: string) =>
    request<{ quality: AlbumQuality | null }>("GET", `/catalog/albums/${encodeURIComponent(id)}/quality${query({ sf: storefront })}`),
  artist: (id: string) => request<ArtistDetail>("GET", `/catalog/artists/${encodeURIComponent(id)}${query({})}`),
};
