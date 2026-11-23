import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoStreamer } from "../src/analysis/demo.js";
import { createApp } from "../src/server/app.js";
import { JobStore } from "../src/server/jobs.js";
import { ReportStore } from "../src/server/store.js";
import { solidPng, testConfig } from "./helpers.js";

let dir: string;
let jobs: JobStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "troonooz-test-"));
  jobs = new JobStore();
});
afterEach(async () => {
  jobs.close();
  await rm(dir, { recursive: true, force: true });
});

async function makeApp(overrides: Parameters<typeof testConfig>[0] = {}, withStreamer = true) {
  const config = testConfig({ dataDir: dir, demo: true, ...overrides });
  const store = new ReportStore(dir);
  await store.init();
  return { app: createApp({ config, streamer: withStreamer ? demoStreamer({ delayMs: 0 }) : null, store, jobs, log: () => {} }), store };
}

async function waitForJob(id: string) {
  const job = jobs.get(id)!;
  if (job.status !== "running") return job;
  await new Promise<void>((resolve) => job.once("event", function check(e) {
    if (e.type === "progress") job.once("event", check);
    else resolve();
  }));
  return job;
}

describe("HTTP API", () => {
  it("runs an analysis from upload to stored report", async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post("/api/analyze")
      .attach("files", await solidPng(300, 200), "post.png")
      .field("text", "Shark on the highway")
      .field("focus", '["news","media"]')
      .field("source", "web")
      .expect(202);
    expect(res.body.view_url).toBe(`/#/report/${res.body.id}`);
    const job = await waitForJob(res.body.id);
    expect(job.status).toBe("done");

    const report = await request(app).get(`/api/reports/${res.body.id}`).expect(200);
    expect(report.body.demo).toBe(true);
    expect(report.body.input).toMatchObject({ source: "web", focus: ["news", "media"], web_research: true });
    expect(report.body.input.thumbnails[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(report.body.report.sources.every((s: { seen: boolean }) => s.seen)).toBe(true);

    const list = await request(app).get("/api/reports").expect(200);
    expect(list.body.reports[0]).toMatchObject({ id: res.body.id, trust_score: 8 });

    // Events replay for late subscribers, ending with "done".
    const sse = await request(app).get(`/api/jobs/${res.body.id}/events`).expect(200);
    expect(sse.headers["content-type"]).toContain("text/event-stream");
    expect(sse.text).toContain("event: progress");
    expect(sse.text.trim().split("\n\n").at(-1)).toContain("event: done");

    await request(app).delete(`/api/reports/${res.body.id}`).expect(204);
    await request(app).get(`/api/reports/${res.body.id}`).expect(404);
  });

  it("reports input problems through the job", async () => {
    const { app } = await makeApp();
    const res = await request(app).post("/api/analyze").field("source", "web").expect(202);
    const job = await waitForJob(res.body.id);
    expect(job.status).toBe("error");
    expect(job.events.at(-1)).toMatchObject({ type: "error", code: "input" });
  });

  it("explains a missing Claude configuration", async () => {
    const { app } = await makeApp({ demo: false }, false);
    const health = await request(app).get("/api/health").expect(200);
    expect(health.body.claude_configured).toBe(false);
    const res = await request(app).post("/api/analyze").field("text", "hello").expect(202);
    const job = await waitForJob(res.body.id);
    expect(job.events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("ANTHROPIC_API_KEY") });
  });

  it("rejects malformed page JSON", async () => {
    const { app } = await makeApp();
    await request(app).post("/api/analyze").field("page", "{not json").expect(400);
  });

  it("requires the API token when configured, including via ?token for SSE", async () => {
    const { app } = await makeApp({ apiToken: "s3cret" });
    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/reports").expect(401);
    await request(app).get("/api/reports").set("Authorization", "Bearer wrong").expect(401);
    await request(app).get("/api/reports").set("Authorization", "Bearer s3cret").expect(200);
    const res = await request(app).post("/api/analyze").set("Authorization", "Bearer s3cret").field("text", "x").expect(202);
    await waitForJob(res.body.id);
    await request(app).get(`/api/jobs/${res.body.id}/events?token=s3cret`).expect(200);
  });

  it("limits concurrent analyses", async () => {
    const { app } = await makeApp({ maxConcurrent: 0 });
    const res = await request(app).post("/api/analyze").field("text", "x").expect(429);
    expect(res.body.error).toBe("busy");
  });

  it("allows browser-extension origins only", async () => {
    const { app } = await makeApp();
    const ext = await request(app).options("/api/analyze").set("Origin", "chrome-extension://abcdef").expect(204);
    expect(ext.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdef");
    const web = await request(app).get("/api/health").set("Origin", "https://evil.example").expect(200);
    expect(web.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects path-traversal style report IDs and serves the web app", async () => {
    const { app } = await makeApp();
    await request(app).get("/api/reports/..%2F..%2Fetc%2Fpasswd").expect(404);
    const home = await request(app).get("/").expect(200);
    expect(home.text).toContain("troonooz");
    expect(home.headers["content-security-policy"]).toContain("script-src 'self'");
  });
});
