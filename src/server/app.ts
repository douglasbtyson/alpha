import Anthropic from "@anthropic-ai/sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, AnalysisError, type KnowledgeAccess, type Streamer } from "../analysis/analyzer.js";
import { lookupDomain, type DomainInfo } from "../analysis/domain.js";
import { evidenceDomains, InputError, prepareEvidence, resolveDomains, type PreparedEvidence } from "../analysis/evidence.js";
import { focusCovers, formatGroups, formatStories, groupUrls, modeCovers, type KnowledgeBase, type StoryCard } from "../knowledge/base.js";
import type { StorySignature, TriageRunner } from "../knowledge/triage.js";
import {
  isHttpUrl,
  PageCaptureSchema,
  parseBool,
  parseFocus,
  parseList,
  type AnalysisInput,
  type FrameUpload,
  type InputSource,
  type PageCapture,
  type UploadedFile,
} from "../analysis/input.js";
import { hasFfmpeg } from "../analysis/video.js";
import type { Config } from "../config.js";
import { JobStore, type Job, type JobEvent } from "./jobs.js";
import { ID_RE, ReportStore, type AnalysisRecord } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));
/** public/ sits at the repo root, two levels up from src/server and dist/server. */
export const PUBLIC_DIR = join(here, "..", "..", "public");

/**
 * A fingerprint of the web app's files. Sent on every API response so a page
 * that was opened before an update can tell it is out of date and ask the
 * user to reload, instead of misreading responses it doesn't understand.
 */
export function uiVersion(dir = PUBLIC_DIR): string {
  const hash = createHash("sha256");
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(html|js|css)$/.test(entry.name)) hash.update(entry.name).update(readFileSync(p));
    }
  };
  try {
    walk(dir);
  } catch {
    return "unknown";
  }
  return hash.digest("hex").slice(0, 12);
}

export interface AppDeps {
  config: Config;
  /** Null when the Claude client could not be created; analyses then fail with a clear message. */
  streamer: Streamer | null;
  /** Whether Claude credentials appear to be configured (shown by /api/health and the UI banner). */
  claudeConfigured?: boolean;
  store: ReportStore;
  jobs: JobStore;
  /** Shared knowledge base (instant matches, earlier findings); null when disabled. */
  knowledge?: KnowledgeBase | null;
  /** Story triage before the full analysis; null when disabled. */
  triage?: TriageRunner | null;
  log?: (msg: string) => void;
}

function friendlyError(err: unknown, model: string, configured: boolean): { code: string; message: string; internal: boolean } {
  if (err instanceof InputError) return { code: "input", message: err.message, internal: false };
  if (err instanceof AnalysisError) return { code: err.code, message: err.message, internal: false };
  if (err instanceof Anthropic.AuthenticationError) {
    return { code: "auth", message: "The Anthropic API rejected the server's credentials. Check ANTHROPIC_API_KEY.", internal: false };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { code: "permission", message: `This API key is not permitted to use ${model} or one of the requested features.`, internal: false };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { code: "model_not_found", message: `Model "${model}" was not found or is not available to this API key.`, internal: false };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { code: "rate_limited", message: "The Anthropic API rate limit was reached. Wait a minute and try again.", internal: false };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { code: "bad_request", message: `The Anthropic API rejected the request: ${err.message}`, internal: false };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { code: "network", message: "Could not reach the Anthropic API. Check the server's network connection.", internal: false };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 529 || status >= 500) {
      return { code: "overloaded", message: "The Anthropic API is temporarily overloaded or unavailable. Try again shortly.", internal: false };
    }
    return { code: "api", message: `Anthropic API error ${status}: ${err.message}`, internal: false };
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Raised by the SDK before or after the HTTP call, e.g. when no credentials can be resolved.
    const hint = configured ? "" : " Set ANTHROPIC_API_KEY on the server and restart it.";
    return { code: "client", message: `Claude client error: ${err.message.replace(/\.?\s*$/, ".")}${hint}`, internal: false };
  }
  return { code: "internal", message: "Something went wrong while analyzing. Check the server log for details.", internal: true };
}

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface FrameInfo {
  video?: unknown;
  time?: unknown;
  duration?: unknown;
}

export function createApp(deps: AppDeps): express.Express {
  const { config, store, jobs } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const kb = deps.knowledge ?? null;
  const version = uiVersion();
  const claudeConfigured = deps.claudeConfigured ?? deps.streamer !== null;
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    // Browser extensions call the API cross-origin; allow only extension origins.
    const origin = req.headers.origin;
    if (origin && /^(chrome|moz|safari-web)-extension:\/\//.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (req.path.startsWith("/api/")) res.setHeader("X-Troonooz-UI", version);
    next();
  });

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!config.apiToken) return next();
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    // EventSource cannot send headers, so the SSE endpoint also accepts ?token=.
    const query = typeof req.query.token === "string" ? req.query.token : "";
    if ((bearer && tokenMatches(bearer, config.apiToken)) || (query && tokenMatches(query, config.apiToken))) return next();
    res.status(401).json({ error: "unauthorized", message: "A valid API token is required." });
  };

  app.get("/api/health", async (_req, res) => {
    res.json({
      ok: true,
      app: "troonooz",
      ui_version: version,
      demo: config.demo,
      model: config.demo ? "demo" : config.model,
      claude_configured: claudeConfigured,
      web_research: config.webSearchMaxUses > 0 || config.webFetchMaxUses > 0,
      server_video: await hasFfmpeg(),
      auth_required: config.apiToken !== null,
      knowledge: kb ? { enabled: true, ...kb.stats() } : { enabled: false },
      limits: { max_files: config.maxFiles, max_file_mb: Math.round(config.maxFileBytes / 1048576), max_images: config.maxImages },
    });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileBytes, files: config.maxFiles + 64, fields: 40, fieldSize: 4 * 1024 * 1024 },
  }).fields([
    { name: "files", maxCount: config.maxFiles },
    { name: "frames", maxCount: 64 },
  ]);

  app.post("/api/analyze", requireAuth, (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message =
          err.code === "LIMIT_FILE_SIZE"
            ? `A file is larger than the ${Math.round(config.maxFileBytes / 1048576)} MB limit.`
            : `Upload rejected: ${err.message}`;
        res.status(status).json({ error: "upload", message });
        return;
      }
      if (err) return next(err);
      handleAnalyze(req, res);
    });
  });

  const handleAnalyze = (req: Request, res: Response) => {
    if (jobs.runningCount() >= config.maxConcurrent) {
      res.status(429).json({ error: "busy", message: "Too many analyses are running. Try again in a minute." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fileMap = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const toUpload = (f: Express.Multer.File): UploadedFile => ({
      name: f.originalname.slice(0, 200) || "upload",
      mimeType: f.mimetype,
      buffer: f.buffer,
    });

    let page: PageCapture | null = null;
    if (str(body.page).trim()) {
      try {
        const parsed = PageCaptureSchema.safeParse(JSON.parse(str(body.page)));
        if (parsed.success) page = parsed.data;
      } catch {
        res.status(400).json({ error: "input", message: "The page field must be JSON." });
        return;
      }
    }

    let frameInfo: FrameInfo[] = [];
    if (str(body.frame_info).trim()) {
      try {
        const parsed = JSON.parse(str(body.frame_info)) as unknown;
        if (Array.isArray(parsed)) frameInfo = parsed as FrameInfo[];
      } catch {
        res.status(400).json({ error: "input", message: "frame_info must be a JSON array." });
        return;
      }
    }
    const frames: FrameUpload[] = (fileMap.frames ?? []).map((f, i) => {
      const info = frameInfo[i] ?? {};
      const time = Number(info.time);
      const duration = Number(info.duration);
      return {
        ...toUpload(f),
        video: (typeof info.video === "string" && info.video.trim().slice(0, 200)) || "video",
        time: Number.isFinite(time) && time >= 0 ? time : i,
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      };
    });

    const sourceRaw = str(body.source);
    const source: InputSource = sourceRaw === "web" || sourceRaw === "extension" ? sourceRaw : "api";
    const input: AnalysisInput = {
      files: (fileMap.files ?? []).map(toUpload),
      frames,
      imageUrls: parseList(body.image_urls).filter(isHttpUrl),
      text: str(body.text),
      urls: parseList(body.urls).filter(isHttpUrl),
      page,
      focus: parseFocus(body.focus),
      webResearch: parseBool(body.web, true),
      source,
      mode: str(body.mode) === "quick" ? "quick" : "thorough",
    };

    const job = jobs.create();
    res.status(202).json(jobLinks(job));
    void runJob(job, input, { reuse: parseBool(body.reuse, true) });
  };

  const jobLinks = (job: Job) => ({
    id: job.id,
    events_url: `/api/jobs/${job.id}/events`,
    report_url: `/api/reports/${job.id}`,
    view_url: `/#/report/${job.id}`,
  });

  /** RDAP through the knowledge base's cache, when there is one. */
  const domainLookup = async (domain: string): Promise<DomainInfo> => {
    const cached = kb?.cachedDomain(domain);
    if (cached) return cached;
    const info = await lookupDomain(domain);
    kb?.saveDomain(info);
    return info;
  };

  const runJob = async (
    job: Job,
    input: AnalysisInput,
    opts: { reuse: boolean; evidence?: PreparedEvidence; linkTo?: string; signature?: StorySignature | null },
  ) => {
    const started = Date.now();
    const status = (message: string) => job.progress({ type: "status", message });
    const mode = input.mode ?? "thorough";
    let prepareMs = 0;
    let reuseMs = 0;
    const time = async <T>(fn: () => Promise<T>, add: (ms: number) => void): Promise<T> => {
      const t = Date.now();
      try {
        return await fn();
      } finally {
        add(Date.now() - t);
      }
    };
    try {
      if (!deps.streamer) {
        throw new AnalysisError(
          "incomplete",
          "No Claude credentials are configured on the server. Set ANTHROPIC_API_KEY (or run in demo mode with TROONOOZ_DEMO=1).",
        );
      }
      let evidence = opts.evidence;
      if (!evidence) {
        status("Preparing evidence");
        evidence = await time(() => prepareEvidence(input, config, status), (ms) => (prepareMs += ms));
      }
      const ev: PreparedEvidence = evidence;
      const reuseStarted = Date.now();

      // Layer 1: the same content was already checked recently.
      if (kb && opts.reuse && evidence.matchable) {
        status("Looking for earlier checks of the same content");
        const m = await kb.findMatch(evidence.fingerprints, { focus: input.focus, webResearch: input.webResearch, demo: config.demo, mode });
        const summary = m ? store.summary(m.id) : null;
        if (m && summary) {
          job.matched(
            {
              id: m.id,
              created_at: m.createdAt,
              matched_on: m.matchedOn,
              headline: summary.headline,
              rating: summary.rating,
              trust_score: summary.trust_score,
              thumbnail: summary.thumbnail,
            },
            { input, evidence, linkTo: m.id, signature: null },
          );
          log(`[troonooz] ${job.id} matched earlier report ${m.id} (${m.matchedOn.join(", ")})`);
          return;
        }
      }

      // Layer 1.5: the same story, recognised from a different screenshot, crop, or caption.
      let linkTo: string | null = opts.linkTo ?? null;
      let signature: StorySignature | null = opts.signature ?? null;
      let storyLeads: StoryCard[] = [];
      const readable = evidence.images.length + evidence.remoteImages.length > 0 || Boolean(evidence.text || evidence.page?.text || evidence.page?.selection);
      if (kb && deps.triage && config.storyTriage && opts.reuse && !linkTo && readable && kb.storyCount(config.demo) > 0) {
        status("Comparing with stories checked before");
        try {
          const t = await deps.triage(evidence, (text) => kb.findStories(text, { demo: config.demo }));
          signature = t.signature;
          log(
            `[troonooz] ${job.id} triage: ${t.candidates.length} candidate(s), ${t.verdict?.storyId ? `${t.verdict.confidence} match ${t.verdict.storyId}` : "no match"} (${t.usage.input_tokens + t.usage.cache_read_input_tokens} in / ${t.usage.output_tokens} out tokens)`,
          );
          const card = t.verdict?.storyId ? t.candidates.find((c) => c.id === t.verdict!.storyId) : undefined;
          if (card) storyLeads.push(card);
          if (card && t.verdict!.confidence === "high") {
            linkTo = card.latestReport;
            const usable =
              card.reusable && (!input.webResearch || card.webResearch) && focusCovers(card.focus, input.focus) && modeCovers(card.mode, mode);
            const summary = usable ? store.summary(card.latestReport) : null;
            if (summary) {
              job.matched(
                {
                  id: card.latestReport,
                  created_at: summary.created_at,
                  matched_on: ["story"],
                  headline: summary.headline,
                  rating: summary.rating,
                  trust_score: summary.trust_score,
                  thumbnail: summary.thumbnail,
                  story: { id: card.id, title: card.title, checks: card.checks, reason: t.verdict!.reason },
                },
                { input, evidence, linkTo: card.latestReport, signature },
              );
              log(`[troonooz] ${job.id} matched story ${card.id} (latest report ${card.latestReport})`);
              return;
            }
          }
        } catch (err) {
          // Triage only saves work; never let it stop a check.
          log(`[troonooz] ${job.id} story triage skipped: ${(err as Error).message}`);
        }
      }

      reuseMs = Date.now() - reuseStarted;
      evidence.domains = await time(() => resolveDomains(ev, config, status, domainLookup), (ms) => (prepareMs += ms));
      const relatedStarted = Date.now();

      // Layer 2: what earlier checks found about the same entities.
      let knowledge: KnowledgeAccess | undefined;
      if (kb) {
        const demo = config.demo;
        const related = await kb.related(evidence.fingerprints, evidenceDomains(evidence), { demo });
        const stories = [...storyLeads];
        for (const c of kb.storiesOfReports([...(await kb.reportsSharing(evidence.fingerprints, demo)), ...(linkTo ? [linkTo] : [])])) {
          if (!stories.some((x) => x.id === c.id)) stories.push(c);
        }
        const parts = [stories.length ? formatStories(stories) : "", related.length ? formatGroups(related) : ""].filter(Boolean);
        if (parts.length) {
          evidence.priorFindings = parts.join("\n");
          const n = stories.length + related.length;
          status(`Found ${n} related item${n === 1 ? "" : "s"} from earlier checks`);
        }
        knowledge = {
          search: (query, kind) => {
            const storyHits = kind === "any" ? kb.findStories(query, { demo, limit: 3 }) : [];
            const groups = kb.search(query, kind, { demo });
            const text = [storyHits.length ? formatStories(storyHits) : "", groups.length ? formatGroups(groups) : ""].filter(Boolean).join("\n");
            return { text, urls: groupUrls(groups), count: storyHits.length + groups.length };
          },
          priorUrls: groupUrls(related),
        };
      }

      prepareMs += Date.now() - relatedStarted;
      status(config.demo ? "Running demo analysis (sample data)" : mode === "quick" ? "Running a quick check with Claude" : "Analyzing with Claude");
      const result = await analyze(
        evidence,
        { focus: input.focus, webResearch: input.webResearch, source: input.source, knowledge, mode },
        config,
        deps.streamer,
        (e) => job.progress(e),
      );
      const record: AnalysisRecord = {
        id: job.id,
        created_at: new Date(started).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        demo: config.demo,
        model: result.model,
        input: {
          source: input.source,
          focus: input.focus,
          web_research: input.webResearch,
          mode,
          text_excerpt: evidence.text.slice(0, 500),
          urls: evidence.urls,
          page: evidence.page ? { url: evidence.page.url, title: evidence.page.title } : null,
          thumbnails: evidence.thumbnails,
          notes: evidence.notes,
          fingerprints: evidence.fingerprints,
          story_signature: signature,
        },
        signals: evidence.signals,
        domains: evidence.domains,
        report: result.report,
        research: result.research,
        usage: result.usage,
        turns: result.turns,
        zooms: result.zooms,
        linked_to: linkTo,
        timing: {
          prepare_ms: prepareMs,
          reuse_ms: reuseMs,
          research_ms: result.timing.research_ms,
          writing_ms: result.timing.writing_ms,
          total_ms: Date.now() - started,
        },
      };
      await store.save(record);
      try {
        kb?.indexReport(record);
        await kb?.linkStory(record);
      } catch (err) {
        // The JSON report is the source of truth; the index is rebuilt from it at startup.
        console.error(`[troonooz] ${job.id} could not be added to the knowledge base:`, err);
      }
      job.done();
      const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
      log(
        `[troonooz] ${job.id} done in ${sec(Date.now() - started)} (${mode}: prepare ${sec(prepareMs)}, earlier checks ${sec(reuseMs)}, research ${sec(result.timing.research_ms)}, writing ${sec(result.timing.writing_ms)}; ${result.turns} turns, ${result.research.queries.length} searches)`,
      );
    } catch (err) {
      const fe = friendlyError(err, config.model, claudeConfigured);
      if (fe.internal) console.error(`[troonooz] ${job.id} failed:`, err);
      else log(`[troonooz] ${job.id} failed: ${fe.code}: ${fe.message}`);
      job.fail(fe.code, fe.message);
    }
  };

  app.get("/api/jobs/:id", requireAuth, (req, res) => {
    const id = String(req.params.id);
    const job = jobs.get(id);
    if (!job) {
      if (store.has(id)) {
        res.json({ id, status: "done", events: [] });
        return;
      }
      res.status(404).json({ error: "not_found", message: "No such job." });
      return;
    }
    res.json({ id, status: job.status, events: job.events });
  });

  /** Run a full check on content that matched an earlier report, without re-uploading it. */
  app.post("/api/jobs/:id/rerun", requireAuth, (req, res) => {
    const previous = jobs.get(String(req.params.id));
    if (!previous || previous.status !== "matched" || !previous.retained) {
      res.status(404).json({ error: "not_found", message: "This check can no longer be re-run. Submit the content again." });
      return;
    }
    if (jobs.runningCount() >= config.maxConcurrent) {
      res.status(429).json({ error: "busy", message: "Too many analyses are running. Try again in a minute." });
      return;
    }
    const job = jobs.create();
    res.status(202).json(jobLinks(job));
    const { input: retainedInput, evidence, linkTo, signature } = previous.retained;
    void runJob(job, retainedInput, { reuse: false, evidence, linkTo, signature });
  });

  app.get("/api/jobs/:id/events", requireAuth, (req, res) => {
    const id = String(req.params.id);
    const job = jobs.get(id);
    if (!job && !store.has(id)) {
      res.status(404).json({ error: "not_found", message: "No such job." });
      return;
    }
    // Every event carries its index as the SSE id. A reconnecting EventSource sends the last id it
    // saw, so it resumes instead of replaying everything; once it has the final event, HTTP 204
    // tells it to stop reconnecting for good.
    const lastSeen = Number.parseInt(String(req.headers["last-event-id"] ?? ""), 10);
    const from = Number.isFinite(lastSeen) && lastSeen >= 0 ? lastSeen + 1 : 0;
    const total = job ? job.events.length : 1;
    if ((!job || job.status !== "running") && from >= total) {
      res.status(204).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (e: JobEvent, index: number) => res.write(`id: ${index}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    if (!job) {
      send({ type: "done", at: new Date().toISOString(), id }, 0);
      res.end();
      return;
    }
    // Transient events (report drafts) carry no id, so they don't move the resume point.
    const sendTransient = (e: JobEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    job.events.slice(from).forEach((e, k) => send(e, from + k));
    if (job.status !== "running") {
      res.end();
      return;
    }
    if (job.latestDraft) sendTransient(job.latestDraft);
    const onEvent = (e: JobEvent, transient?: boolean) => {
      if (transient) {
        sendTransient(e);
        return;
      }
      send(e, job.events.length - 1);
      if (e.type !== "progress") cleanup();
    };
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      job.off("event", onEvent);
      res.end();
    };
    job.on("event", onEvent);
    // The response's close (not the request's) is what signals the client went away.
    res.on("close", cleanup);
  });

  app.get("/api/reports", requireAuth, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50));
    res.json({ reports: store.list(limit) });
  });

  app.get("/api/reports/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    const rec = ID_RE.test(id) ? await store.get(id) : null;
    if (!rec) {
      const job = jobs.get(id);
      if (job?.status === "running") {
        res.status(202).json({ status: "running" });
        return;
      }
      res.status(404).json({ error: "not_found", message: "No such report." });
      return;
    }
    const story = kb?.storyOf(id);
    res.json({
      ...rec,
      story: story ? { id: story.card.id, title: story.card.title, checks: story.card.checks, members: story.members } : null,
    });
  });

  app.delete("/api/reports/:id", requireAuth, async (req, res) => {
    const id = String(req.params.id);
    const ok = await store.delete(id);
    if (!ok) {
      res.status(404).json({ error: "not_found", message: "No such report." });
      return;
    }
    kb?.removeReport(id);
    res.status(204).end();
  });

  /** A user thinks the result is wrong: never reuse it, and warn when its findings come up. */
  app.post("/api/reports/:id/dispute", requireAuth, express.json({ limit: "16kb" }), async (req, res) => {
    const id = String(req.params.id);
    const body = (req.body ?? {}) as { note?: unknown };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const rec = ID_RE.test(id) ? await store.markDisputed(id, note) : null;
    if (!rec) {
      res.status(404).json({ error: "not_found", message: "No such report." });
      return;
    }
    kb?.dispute(id, note);
    res.status(204).end();
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found", message: "Unknown API route." });
  });

  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders: (res) => {
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
      },
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[troonooz] request error:", err);
    if (!res.headersSent) res.status(500).json({ error: "internal", message: "Internal server error." });
  });

  return app;
}
