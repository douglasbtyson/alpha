import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Client } from "./api";
import type { AnalysisRecord, JobEvent, MatchInfo, ReportDraft } from "./types";

export type CheckState =
  | { phase: "loading" }
  | { phase: "running"; events: JobEvent[]; draft: ReportDraft | null; startedAt: number; reconnecting: boolean }
  | { phase: "matched"; match: MatchInfo }
  | { phase: "error"; message: string; code: string }
  | { phase: "done"; record: AnalysisRecord };

const POLL_MS = 1200;

/** Follows a check from "running" to its report, polling the server (React Native has no EventSource). */
export function useCheck(client: Client | null, id: string | undefined) {
  const [state, setState] = useState<CheckState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);

  const reload = useCallback(() => {
    failures.current = 0;
    setState({ phase: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!client || !id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = (ms: number) => {
      if (alive) timer = setTimeout(tick, ms);
    };

    async function tick() {
      try {
        const job = await client!.job(id!);
        if (!alive) return;
        failures.current = 0;
        if (job.status === "running") {
          const first = job.events[0];
          setState({
            phase: "running",
            events: job.events,
            draft: job.draft ?? null,
            startedAt: first ? Date.parse(first.at) : Date.now(),
            reconnecting: false,
          });
          later(POLL_MS);
          return;
        }
        if (job.status === "matched") {
          const m = job.events.find((e) => e.type === "match");
          if (m && m.type === "match") {
            setState({ phase: "matched", match: m.match });
            return;
          }
        }
        if (job.status === "error") {
          const e = job.events.find((x) => x.type === "error");
          setState({ phase: "error", message: e && e.type === "error" ? e.message : "The check failed.", code: e && e.type === "error" ? e.code : "error" });
          return;
        }
        const record = await client!.report(id!);
        if (alive) setState({ phase: "done", record });
      } catch (err) {
        if (!alive) return;
        const api = err instanceof ApiError ? err : null;
        if (api?.status === 404) {
          setState({ phase: "error", message: "This check isn't on your troonooz server. It may have been deleted, or it ran on a different server.", code: "not_found" });
          return;
        }
        if (api && api.status !== 0 && api.code !== "timeout") {
          setState({ phase: "error", message: api.message, code: api.code });
          return;
        }
        // The connection dropped (the iPhone slept, or Tailscale reconnected): keep trying for a while.
        failures.current += 1;
        if (failures.current > 20) {
          setState({ phase: "error", message: api?.message ?? "Lost touch with your troonooz server.", code: "network" });
          return;
        }
        setState((s) => (s.phase === "running" ? { ...s, reconnecting: true } : s));
        later(Math.min(10_000, POLL_MS * 2 ** Math.min(failures.current, 3)));
      }
    }

    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, id, attempt]);

  return { state, reload };
}
