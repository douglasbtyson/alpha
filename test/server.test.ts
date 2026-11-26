import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { demoStreamer } from "../src/analysis/demo.js";
import { KnowledgeBase } from "../src/knowledge/base.js";
import type { TriageRunner } from "../src/knowledge/triage.js";
import type { Streamer } from "../src/analysis/analyzer.js";
import { createApp, uiVersion } from "../src/server/app.js";
import { mkdir, writeFile } from "node:fs/promises";
import { JobStore } from "../src/server/jobs.js";
import { ReportStore } from "../src/server/store.js";
import { photo, solidPng, testConfig } from "./helpers.js";

let dir: string;
let jobs: JobStore;
let kb: KnowledgeBase | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "troonooz-test-"));
  jobs = new JobStore();
});
afterEach(async () => {
  jobs.close();
  kb?.close();
  kb = null;
  await rm(dir, { recursive: true, force: true });
});

async function makeApp(overrides: Parameters<typeof testConfig>[0] = {}, withStreamer = true, withKnowledge = false) {
  const config = testConfig({ dataDir: dir, demo: true, ...overrides });
  const store = new ReportStore(dir);
  await store.init();
  if (withKnowledge) kb = new KnowledgeBase(dir);
  return {
    app: createApp({ config, streamer: withStreamer ? demoStreamer({ delayMs: 0 }) : null, store, jobs, knowledge: kb, log: () => {} }),
    store,
  };
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

  it("resumes event streams from Last-Event-ID and stops finished ones with 204", async () => {
    const { app } = await makeApp();
    const res = await request(app).post("/api/analyze").field("text", "Shark on the highway").expect(202);
    const job = await waitForJob(res.body.id);
    const last = job.events.length - 1;
    const full = await request(app).get(`/api/jobs/${job.id}/events`).expect(200);
    expect(full.text).toContain("id: 0\n");
    expect(full.text).toContain(`id: ${last}\n`);
    const resumed = await request(app).get(`/api/jobs/${job.id}/events`).set("Last-Event-ID", String(last - 1)).expect(200);
    expect(resumed.text).not.toContain("id: 0\n");
    expect(resumed.text.match(/^id: /gm)).toHaveLength(1);
    // A client that already has the final event must not be fed it again (that caused a reconnect loop).
    await request(app).get(`/api/jobs/${job.id}/events`).set("Last-Event-ID", String(last)).expect(204);
  });

  it("labels API responses with the web app's version", async () => {
    const { app } = await makeApp();
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-troonooz-ui"]).toMatch(/^[0-9a-f]{12}$/);
    expect(res.body.ui_version).toBe(res.headers["x-troonooz-ui"]);
    const ui = join(dir, "ui");
    await mkdir(join(ui, "js"), { recursive: true });
    await writeFile(join(ui, "app.js"), "a");
    const before = uiVersion(ui);
    await writeFile(join(ui, "js", "x.js"), "b");
    expect(uiVersion(ui)).not.toBe(before);
  });

  it("records the check mode and where the time went", async () => {
    const { app, store } = await makeApp();
    const res = await request(app).post("/api/analyze").field("text", "Shark on the highway").field("mode", "quick").expect(202);
    await waitForJob(res.body.id);
    const rec = (await store.get(res.body.id))!;
    expect(rec.input.mode).toBe("quick");
    expect(rec.timing).toMatchObject({ prepare_ms: expect.any(Number), research_ms: expect.any(Number), writing_ms: expect.any(Number) });
    expect(rec.timing!.total_ms).toBeGreaterThanOrEqual(rec.timing!.research_ms + rec.timing!.writing_ms);
  });

  it("retries a quick check on the main model when the quick model declines it", async () => {
    const config = testConfig({ dataDir: dir, demo: true });
    const store = new ReportStore(dir);
    await store.init();
    const demo = demoStreamer({ delayMs: 0 });
    const models: string[] = [];
    const streamer: Streamer = async (params, hooks) => {
      models.push(params.model);
      if (params.model === config.quickModel) {
        return { ...(await demo(params, {})), content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } } as never;
      }
      return demo(params, hooks);
    };
    const app = createApp({ config, streamer, store, jobs, log: () => {} });
    const res = await request(app).post("/api/analyze").field("text", "Shark on the highway").field("mode", "quick").expect(202);
    const job = await waitForJob(res.body.id);
    expect(job.status).toBe("done");
    expect(models).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect((await store.get(res.body.id))!.input.mode).toBe("quick");
  });

  it("sends report drafts live without adding them to the replay history", () => {
    const job = jobs.create();
    const seen: Array<[string, boolean | undefined]> = [];
    job.on("event", (e, transient) => seen.push([e.event?.type ?? e.type, transient]));
    job.progress({ type: "writing" });
    job.progress({ type: "draft", draft: { rating: "mixed", trust_score: 55, confidence: null, headline: "", summary: "", explanation: "" } });
    expect(job.events.map((e) => (e.type === "progress" ? e.event.type : e.type))).toEqual(["writing"]);
    expect(job.latestDraft).not.toBeNull();
    expect(seen).toEqual([["writing", undefined], ["draft", true]]);
  });

  describe("iPhone scan endpoint", () => {
    it("takes a raw screenshot body, defaults to a quick check, and returns a link to open", async () => {
      const { app, store } = await makeApp();
      const res = await request(app)
        .post("/api/scan")
        .set("Host", "my-pc.tail1234.ts.net")
        .set("Content-Type", "image/png")
        .send(await solidPng(390, 844))
        .expect(202);
      expect(res.body.open_url).toBe(`https://my-pc.tail1234.ts.net/#/report/${res.body.id}`);
      const job = await waitForJob(res.body.id);
      expect(job.status).toBe("done");
      const rec = (await store.get(res.body.id))!;
      expect(rec.input).toMatchObject({ source: "shortcut", mode: "quick" });
      expect(rec.input.thumbnails).toHaveLength(1);
      expect(rec.report.background.simple).toContain("shark");
    });

    it("honours forwarded headers, an explicit public URL, and query options", async () => {
      const { app } = await makeApp();
      const fwd = await request(app)
        .post("/api/scan?mode=thorough&focus=news")
        .set("X-Forwarded-Proto", "https")
        .set("X-Forwarded-Host", "troonooz.example.net")
        .set("Content-Type", "image/png")
        .send(await solidPng(100, 100))
        .expect(202);
      expect(fwd.body.open_url).toMatch(/^https:\/\/troonooz\.example\.net\/#\/report\//);
      const job = await waitForJob(fwd.body.id);
      expect(job.status).toBe("done");

      jobs.close();
      jobs = new JobStore();
      const { app: pinned } = await makeApp({ publicUrl: "https://pinned.example/" });
      const res = await request(pinned).post("/api/scan").set("Content-Type", "image/png").send(await solidPng(100, 100)).expect(202);
      expect(res.body.open_url).toBe(`https://pinned.example/#/report/${res.body.id}`);
      await waitForJob(res.body.id);
      const health = await request(pinned).get("/api/health").expect(200);
      expect(health.body.base_url).toBe("https://pinned.example");
    });

    it("accepts a shared link or text, and explains an empty body", async () => {
      const { app, store } = await makeApp();
      const link = await request(app).post("/api/scan").set("Content-Type", "text/plain").send("https://news.example/story?utm_source=x").expect(202);
      await waitForJob(link.body.id);
      expect((await store.get(link.body.id))!.input.urls).toEqual(["https://news.example/story?utm_source=x"]);
      const empty = await request(app).post("/api/scan").set("Content-Type", "image/png").send(Buffer.alloc(0)).expect(400);
      expect(empty.body.message).toContain("Request Body to File");
    });

    it("also accepts the multipart form, as a quick shortcut check by default", async () => {
      const { app, store } = await makeApp();
      const res = await request(app).post("/api/scan").attach("files", await solidPng(200, 200), "s.png").expect(202);
      await waitForJob(res.body.id);
      expect((await store.get(res.body.id))!.input).toMatchObject({ source: "shortcut", mode: "quick" });
    });

    it("requires the API token when one is set", async () => {
      const { app } = await makeApp({ apiToken: "s3cret" });
      await request(app).post("/api/scan").set("Content-Type", "image/png").send(await solidPng(50, 50)).expect(401);
    });
  });

  it("gives content with nothing to verify a 'nothing to check' verdict", async () => {
    const { app, store } = await makeApp();
    const res = await request(app).post("/api/analyze").field("text", "Just a chat with nothing to verify in it, really nothing").expect(202);
    await waitForJob(res.body.id);
    const rec = (await store.get(res.body.id))!;
    expect(rec.report.verdict).toMatchObject({ rating: "nothing_to_check", trust_score: 50, would_raise: "" });
    expect(rec.report.verdict.score_reason).not.toBe("");
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

  describe("knowledge base", () => {
    async function check(app: Parameters<typeof request>[0], image: Buffer, extra: Record<string, string> = {}) {
      let r = request(app).post("/api/analyze").attach("files", image, "photo.jpg").field("source", "web");
      for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
      const res = await r.expect(202);
      return waitForJob(res.body.id);
    }

    it("reuses an earlier report for the same image, and can run a fresh check on request", async () => {
      const { app } = await makeApp({}, true, true);
      const img = await photo(7);
      const first = await check(app, img);
      expect(first.status).toBe("done");

      const reshared = await sharp(img).resize(500).jpeg({ quality: 65 }).toBuffer();
      const second = await check(app, reshared);
      expect(second.status).toBe("matched");
      expect(second.events.at(-1)).toMatchObject({ type: "match", match: { id: first.id, matched_on: ["image"], trust_score: 8 } });
      const sse = await request(app).get(`/api/jobs/${second.id}/events`).expect(200);
      expect(sse.text).toContain("event: match");

      const rerun = await request(app).post(`/api/jobs/${second.id}/rerun`).expect(202);
      const fresh = await waitForJob(rerun.body.id);
      expect(fresh.status).toBe("done");
      await request(app).get(`/api/reports/${fresh.id}`).expect(200);
      await request(app).post(`/api/jobs/${first.id}/rerun`).expect(404); // only matched jobs can be re-run

      const forced = await check(app, img, { reuse: "false" });
      expect(forced.status).toBe("done");

      const health = await request(app).get("/api/health").expect(200);
      expect(health.body.knowledge).toMatchObject({ enabled: true, reports: 3 });
    });

    it("stops reusing a report once someone disputes it", async () => {
      const { app, store } = await makeApp({}, true, true);
      const img = await photo(8);
      const first = await check(app, img);
      await request(app).post(`/api/reports/${first.id}/dispute`).send({ note: "The photo is real" }).expect(204);
      expect((await store.get(first.id))!.disputed).toMatchObject({ note: "The photo is real" });
      expect((await check(app, img)).status).toBe("done");
      await request(app).post("/api/reports/nope12345/dispute").send({}).expect(404);
    });

    it("forgets deleted reports", async () => {
      const { app } = await makeApp({}, true, true);
      const img = await photo(9);
      const first = await check(app, img);
      await request(app).delete(`/api/reports/${first.id}`).expect(204);
      expect((await check(app, img)).status).toBe("done");
    });

    it("never matches featureless images", async () => {
      const { app } = await makeApp({}, true, true);
      const blank = await solidPng(400, 300);
      await check(app, blank);
      expect((await check(app, blank)).status).toBe("done");
    });
  });

  describe("stories", () => {
    type Verdict = "high" | "medium" | "fail";
    async function storyApp(verdict: Verdict) {
      const config = testConfig({ dataDir: dir, demo: true });
      const store = new ReportStore(dir);
      await store.init();
      kb = new KnowledgeBase(dir);
      const prompts: string[] = [];
      const demo = demoStreamer({ delayMs: 0 });
      const streamer: Streamer = async (params, hooks) => {
        prompts.push(JSON.stringify(params.messages[0]!.content));
        return demo(params, hooks);
      };
      let triageCalls = 0;
      const triage: TriageRunner = async (_ev, find) => {
        triageCalls++;
        if (verdict === "fail") throw new Error("overloaded");
        const signature = { description: "shark photo on a flooded highway", claims: [], entities: [], search_terms: "shark flooded highway" };
        const candidates = find("shark flooded highway hoax storm");
        const top = candidates[0];
        return {
          signature,
          candidates,
          verdict: top ? { storyId: top.id, confidence: verdict, reason: "Same doctored shark photo." } : null,
          model: "test",
          usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 },
        };
      };
      const app = createApp({ config, streamer, store, jobs, knowledge: kb, triage, log: () => {} });
      return { app, store, prompts, triageCalls: () => triageCalls };
    }

    async function submit(app: Parameters<typeof request>[0], image: Buffer, focus: string[] = []) {
      const res = await request(app).post("/api/analyze").attach("files", image, "post.jpg").field("focus", JSON.stringify(focus)).expect(202);
      return waitForJob(res.body.id);
    }

    it("recognises the same story in a different screenshot and links a fresh check to it", async () => {
      const { app, store, triageCalls } = await storyApp("high");
      const first = await submit(app, await photo(11));
      expect(first.status).toBe("done");
      expect(triageCalls()).toBe(0); // nothing to compare against yet

      const second = await submit(app, await photo(12));
      expect(triageCalls()).toBe(1);
      expect(second.status).toBe("matched");
      const match = (second.events.at(-1) as { match: { id: string; matched_on: string[]; story: { id: string; checks: number; reason: string } } }).match;
      expect(match).toMatchObject({ id: first.id, matched_on: ["story"], story: { id: kb!.storyIdOf(first.id), checks: 1, reason: "Same doctored shark photo." } });

      const rerun = await request(app).post(`/api/jobs/${second.id}/rerun`).expect(202);
      const fresh = await waitForJob(rerun.body.id);
      expect(fresh.status).toBe("done");
      expect((await store.get(fresh.id))!.linked_to).toBe(first.id);
      const report = await request(app).get(`/api/reports/${fresh.id}`).expect(200);
      expect(report.body.story).toMatchObject({ id: kb!.storyIdOf(first.id), checks: 2 });
      expect(report.body.story.members.map((m: { id: string }) => m.id).sort()).toEqual([first.id, fresh.id].sort());
    });

    it("passes likely-but-uncertain stories to the full check as context", async () => {
      const { app, prompts } = await storyApp("medium");
      await submit(app, await photo(13));
      const second = await submit(app, await photo(14));
      expect(second.status).toBe("done");
      expect(prompts.at(-1)).toContain("STORY: Recycled hoax");
    });

    it("keeps going with a full check when triage fails", async () => {
      const { app, triageCalls } = await storyApp("fail");
      await submit(app, await photo(15));
      const second = await submit(app, await photo(16));
      expect(triageCalls()).toBe(1);
      expect(second.status).toBe("done");
    });

    it("doesn't reuse a story check that covered a different focus, but still links the new report", async () => {
      const { app } = await storyApp("high");
      const first = await submit(app, await photo(17), ["media"]);
      const second = await submit(app, await photo(18), ["news"]);
      expect(second.status).toBe("done");
      expect(kb!.storyIdOf(second.id)).toBe(kb!.storyIdOf(first.id));
    });
  });
});
