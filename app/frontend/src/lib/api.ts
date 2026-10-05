import type { Album, Artist, Job, LogLine, SearchResults, Settings, Status } from "./types";

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

export interface AddJobsResponse {
  added: Job[];
  rejected: { url: string; error: string }[];
}

export const api = {
  status: () => request<Status>("GET", "/status"),

  jobs: () => request<{ jobs: Job[] }>("GET", "/jobs").then((r) => r.jobs),
  job: (id: string) => request<{ job: Job; log: LogLine[] }>("GET", `/jobs/${id}`),
  /** Resolves with both lists even when every link was rejected. */
  addJobs: async (urls: string[]): Promise<AddJobsResponse> => {
    try {
      return await request<AddJobsResponse>("POST", "/jobs", { urls });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.body && typeof e.body === "object" && "rejected" in e.body) {
        return e.body as AddJobsResponse;
      }
      throw e;
    }
  },
  cancelJob: (id: string) => request<unknown>("POST", `/jobs/${id}/cancel`),
  retryJob: (id: string) => request<unknown>("POST", `/jobs/${id}/retry`),
  discardFiles: (id: string) => request<unknown>("DELETE", `/jobs/${id}/files`),
  removeJob: (id: string) => request<unknown>("DELETE", `/jobs/${id}`),

  settings: () => request<{ settings: Settings; defaults: Settings }>("GET", "/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request<{ settings: Settings }>("PUT", "/settings", settings).then((r) => r.settings),

  login: (email: string, password: string) => request<unknown>("POST", "/account/login", { email, password }),
  submitCode: (code: string) => request<unknown>("POST", "/account/code", { code }),

  search: (q: string) => request<SearchResults>("GET", `/catalog/search?q=${encodeURIComponent(q)}`),
  artist: (id: string) => request<Artist & { albums: Album[] }>("GET", `/catalog/artists/${encodeURIComponent(id)}`),
};
