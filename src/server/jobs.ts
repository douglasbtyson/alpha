import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { ProgressEvent } from "../analysis/analyzer.js";
import type { PreparedEvidence } from "../analysis/evidence.js";
import type { AnalysisInput } from "../analysis/input.js";
import type { StorySignature } from "../knowledge/triage.js";

/** An earlier report that already covers this submission. */
export interface MatchInfo {
  id: string;
  created_at: string;
  matched_on: string[];
  headline: string;
  rating: string;
  trust_score: number;
  thumbnail: string | null;
  /** Present when the match is a story (same claim or media, different copy) rather than identical content. */
  story?: { id: string; title: string; checks: number; reason: string };
}

/** What a matched job keeps so the user can still ask for a fresh check. */
export interface Retained {
  input: AnalysisInput;
  evidence: PreparedEvidence;
  /** The earlier report the fresh check should join as the same story. */
  linkTo: string;
  signature: StorySignature | null;
}

export type JobEvent =
  | { type: "progress"; at: string; event: ProgressEvent }
  | { type: "done"; at: string; id: string }
  | { type: "match"; at: string; match: MatchInfo }
  | { type: "error"; at: string; code: string; message: string };

export type JobStatus = "running" | "done" | "matched" | "error";

export class Job extends EventEmitter {
  readonly events: JobEvent[] = [];
  status: JobStatus = "running";
  finishedAt: number | null = null;
  /** Kept for matched jobs so the user can ask for a fresh check without re-uploading. */
  retained: Retained | null = null;

  constructor(
    readonly id: string,
    readonly createdAt = Date.now(),
  ) {
    super();
    this.setMaxListeners(100);
  }

  private push(e: JobEvent): void {
    this.events.push(e);
    this.emit("event", e);
  }

  progress(event: ProgressEvent): void {
    if (this.status !== "running") return;
    this.push({ type: "progress", at: new Date().toISOString(), event });
  }

  done(): void {
    this.status = "done";
    this.finishedAt = Date.now();
    this.push({ type: "done", at: new Date().toISOString(), id: this.id });
  }

  matched(match: MatchInfo, retained: Retained): void {
    this.status = "matched";
    this.finishedAt = Date.now();
    this.retained = retained;
    this.push({ type: "match", at: new Date().toISOString(), match });
  }

  fail(code: string, message: string): void {
    this.status = "error";
    this.finishedAt = Date.now();
    this.push({ type: "error", at: new Date().toISOString(), code, message });
  }
}

/** In-memory registry of running and recently finished jobs. */
export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly ttlMs = 60 * 60 * 1000) {
    this.timer = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.timer.unref();
  }

  create(): Job {
    const id = randomBytes(9).toString("base64url");
    const job = new Job(id);
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  runningCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === "running") n++;
    return n;
  }

  sweep(now = Date.now()): void {
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== null && now - job.finishedAt > this.ttlMs) this.jobs.delete(id);
    }
  }

  close(): void {
    clearInterval(this.timer);
  }
}
