import { existsSync } from "node:fs";

/** Effort levels accepted by `output_config.effort`. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Config {
  port: number;
  host: string;
  /** Claude model used for analysis. */
  model: string;
  /** Reasoning effort. Verification is intelligence-sensitive, so the default is `high`. */
  effort: Effort;
  /** Server-side refusal fallbacks (`fallbacks: "default"`). Disable for proxies that reject the beta. */
  fallbacks: boolean;
  /** Effort for quick checks. */
  quickEffort: Effort;
  /** Max web searches for quick checks. */
  quickSearches: number;
  /** Max web searches Claude may run per analysis (0 disables web search). */
  webSearchMaxUses: number;
  /** Max pages Claude may fetch per analysis (0 disables web fetch). */
  webFetchMaxUses: number;
  /** Max zoom-in crops Claude may request per analysis (0 disables the inspect tool). */
  maxZooms: number;
  /** Look up domain registration age via RDAP. */
  rdap: boolean;
  /** Shared knowledge base: instant matches and findings from earlier checks. */
  knowledge: boolean;
  /** Short pre-check that recognises a story already checked from different screenshots. */
  storyTriage: boolean;
  /** Model for story triage (low effort). */
  triageModel: string;
  /** Where finished reports are persisted as JSON. */
  dataDir: string;
  /** Optional bearer token required on /api requests. */
  apiToken: string | null;
  /** Public base URL for links handed to other apps (e.g. the iPhone shortcut). Derived from the request when unset. */
  publicUrl: string | null;
  /** Serve canned sample reports instead of calling Claude (UI development only). */
  demo: boolean;
  maxFiles: number;
  maxFileBytes: number;
  /** Max images (after tiling / frame extraction) sent to Claude in one analysis. */
  maxImages: number;
  /** Frames sampled from each uploaded video when the server extracts them. */
  videoFrames: number;
  /** Analyses allowed to run at once; further requests get HTTP 429. */
  maxConcurrent: number;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer (got "${raw}")`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean (got "${raw}")`);
}

export function loadConfig(): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const effort = (name: string, fallback: Effort): Effort => {
    const raw = (process.env[name] ?? fallback).trim() as Effort;
    if (!EFFORTS.includes(raw)) throw new Error(`${name} must be one of ${EFFORTS.join(", ")}`);
    return raw;
  };
  const effortRaw = effort("TROONOOZ_EFFORT", "high");

  return {
    port: int("PORT", 8787),
    host: process.env.HOST ?? "127.0.0.1",
    model: process.env.TROONOOZ_MODEL?.trim() || "claude-opus-5-5",
    effort: effortRaw,
    quickEffort: effort("TROONOOZ_QUICK_EFFORT", "medium"),
    quickSearches: int("TROONOOZ_QUICK_SEARCHES", 3),
    fallbacks: bool("TROONOOZ_FALLBACKS", true),
    webSearchMaxUses: int("TROONOOZ_WEB_SEARCH_MAX_USES", 8),
    webFetchMaxUses: int("TROONOOZ_WEB_FETCH_MAX_USES", 5),
    maxZooms: int("TROONOOZ_MAX_ZOOMS", 6),
    rdap: bool("TROONOOZ_RDAP", true),
    knowledge: bool("TROONOOZ_KNOWLEDGE", true),
    storyTriage: bool("TROONOOZ_STORY_TRIAGE", true),
    triageModel: process.env.TROONOOZ_TRIAGE_MODEL?.trim() || "claude-opus-5-5",
    dataDir: process.env.TROONOOZ_DATA_DIR ?? "data",
    apiToken: process.env.TROONOOZ_API_TOKEN?.trim() || null,
    publicUrl: process.env.TROONOOZ_PUBLIC_URL?.trim() || null,
    demo: bool("TROONOOZ_DEMO", false),
    maxFiles: int("TROONOOZ_MAX_FILES", 20),
    maxFileBytes: int("TROONOOZ_MAX_FILE_MB", 100) * 1024 * 1024,
    maxImages: int("TROONOOZ_MAX_IMAGES", 40),
    videoFrames: int("TROONOOZ_VIDEO_FRAMES", 8),
    maxConcurrent: int("TROONOOZ_MAX_CONCURRENT", 3),
  };
}
