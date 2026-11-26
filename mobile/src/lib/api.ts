import { Platform } from "react-native";
import type { AnalysisRecord, Health, JobLinks, JobState, RecordSummary } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

export type CheckMode = "quick" | "thorough";

export function makeClient(server: string, token: string | null) {
  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });

  async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${server}${path}`, { ...init, signal: controller.signal, headers: { ...headers(), ...(init.headers as Record<string, string>) } });
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      throw new ApiError(
        aborted
          ? "The troonooz server took too long to answer."
          : "Can't reach your troonooz server. Check that your computer is on, troonooz is running, and Tailscale is connected on this iPhone.",
        0,
        aborted ? "timeout" : "network",
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message =
        res.status === 401
          ? "Your troonooz server needs an API token. Add it in Settings."
          : typeof body?.message === "string"
            ? body.message
            : `The server answered with an error (${res.status}).`;
      throw new ApiError(message, res.status, typeof body?.error === "string" ? body.error : "http");
    }
    return body as T;
  }

  return {
    server,
    health: () => request<Health>("/api/health", {}, 8_000),
    reports: (limit = 40) => request<{ reports: RecordSummary[] }>(`/api/reports?limit=${limit}`).then((r) => r.reports),
    report: (id: string) => request<AnalysisRecord>(`/api/reports/${encodeURIComponent(id)}`),
    job: (id: string) => request<JobState>(`/api/jobs/${encodeURIComponent(id)}`),
    rerun: (id: string) => request<JobLinks>(`/api/jobs/${encodeURIComponent(id)}/rerun`, { method: "POST" }),
    dispute: (id: string, note: string) =>
      request<void>(`/api/reports/${encodeURIComponent(id)}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      }),
    /** Upload a screenshot or photo from the library for a new check. */
    async check(image: PickedImage, mode: CheckMode): Promise<JobLinks> {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(image.uri)).blob();
        form.append("files", blob, image.name);
      } else {
        // React Native's FormData takes a file reference and streams it from disk.
        form.append("files", { uri: image.uri, name: image.name, type: image.type } as unknown as Blob);
      }
      form.append("source", "app");
      form.append("mode", mode);
      return request<JobLinks>("/api/analyze", { method: "POST", body: form }, 120_000);
    },
  };
}

export type Client = ReturnType<typeof makeClient>;
