import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { ProgressEvent } from "../analysis/analyzer.js";

export type JobEvent =
  | { type: "progress"; at: string; event: ProgressEvent }
  | { type: "done"; at: string; id: string }
  | { type: "error"; at: string; code: string; message: string };

export type JobStatus = "running" | "done" | "error";

export class Job extends EventEmitter {
  readonly events: JobEvent[] = [];
  status: JobStatus = "running";
  finishedAt: number | null = null;

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
