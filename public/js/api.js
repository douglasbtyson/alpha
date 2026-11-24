const TOKEN_KEY = "troonooz.token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the token lasts for this page only.
  }
  memoryToken = token;
}

let memoryToken = "";

function authHeaders() {
  const token = getToken() || memoryToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (res.status === 204) return null;
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok && res.status !== 202) {
    throw new ApiError(res.status, body?.error ?? "http", body?.message ?? `Request failed (HTTP ${res.status})`);
  }
  return body;
}

export const api = {
  health: () => request("/api/health"),
  analyze: (formData) => request("/api/analyze", { method: "POST", body: formData }),
  report: (id) => request(`/api/reports/${encodeURIComponent(id)}`),
  reports: () => request("/api/reports?limit=100"),
  deleteReport: (id) => request(`/api/reports/${encodeURIComponent(id)}`, { method: "DELETE" }),
  job: (id) => request(`/api/jobs/${encodeURIComponent(id)}`),
  rerun: (id) => request(`/api/jobs/${encodeURIComponent(id)}/rerun`, { method: "POST" }),
  dispute: (id, note) =>
    request(`/api/reports/${encodeURIComponent(id)}/dispute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }),
};

/**
 * Subscribe to a job's live events. EventSource can't send headers, so the
 * token (if any) goes in the query string.
 */
export function subscribe(id, handlers) {
  const token = getToken() || memoryToken;
  const url = `/api/jobs/${encodeURIComponent(id)}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  const es = new EventSource(url);
  let finished = false;
  es.addEventListener("progress", (e) => handlers.progress?.(JSON.parse(e.data)));
  es.addEventListener("match", (e) => {
    finished = true;
    es.close();
    handlers.match?.(JSON.parse(e.data));
  });
  es.addEventListener("done", (e) => {
    finished = true;
    es.close();
    handlers.done?.(JSON.parse(e.data));
  });
  es.addEventListener("error", (e) => {
    if (e.data) {
      finished = true;
      es.close();
      handlers.error?.(JSON.parse(e.data));
      return;
    }
    // Connection-level error: EventSource retries on its own unless the job is gone.
    if (!finished && es.readyState === EventSource.CLOSED) handlers.disconnected?.();
  });
  return () => {
    finished = true;
    es.close();
  };
}
