import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { anthropicStreamer, type Streamer } from "./analysis/analyzer.js";
import { demoStreamer } from "./analysis/demo.js";
import { hasFfmpeg } from "./analysis/video.js";
import { loadConfig } from "./config.js";
import { KnowledgeBase } from "./knowledge/base.js";
import { createApp } from "./server/app.js";
import { JobStore } from "./server/jobs.js";
import { ReportStore } from "./server/store.js";

const config = loadConfig();

let streamer: Streamer | null = null;
let claudeConfigured = false;
if (config.demo) {
  streamer = demoStreamer();
  claudeConfigured = true;
} else {
  try {
    // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile, or workload identity.
    const client = new Anthropic();
    streamer = anthropicStreamer(client);
    // The SDK resolves profiles and federation lazily, so this is a best-effort check for the UI.
    claudeConfigured =
      Boolean(client.apiKey || client.authToken) ||
      Boolean(process.env.ANTHROPIC_PROFILE || process.env.ANTHROPIC_FEDERATION_RULE_ID) ||
      existsSync(join(homedir(), ".config", "anthropic"));
  } catch (err) {
    console.warn(`[troonooz] Claude client not configured: ${(err as Error).message}`);
  }
  if (!claudeConfigured) console.warn("No Claude credentials found: set ANTHROPIC_API_KEY (or run `ant auth login`).");
}

const store = new ReportStore(config.dataDir);
await store.init();
const jobs = new JobStore();
let knowledge: KnowledgeBase | null = null;
if (config.knowledge) {
  knowledge = new KnowledgeBase(config.dataDir);
  const added = await knowledge.syncFrom(store);
  if (added) console.log(`Knowledge base: indexed ${added} existing report${added === 1 ? "" : "s"}.`);
}
const app = createApp({ config, streamer, claudeConfigured, store, jobs, knowledge });

app.listen(config.port, config.host, async () => {
  const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  console.log(`troonooz listening on ${url}`);
  if (config.demo) {
    console.log("DEMO MODE: every analysis returns a fixed sample report. Unset TROONOOZ_DEMO to use Claude.");
  } else {
    console.log(`Model: ${config.model} (effort ${config.effort}); web search ${config.webSearchMaxUses > 0 ? "on" : "off"}`);
  }
  if (!(await hasFfmpeg())) console.log("ffmpeg not found: raw video uploads need browser-side frame extraction.");
  if (config.apiToken) console.log("API token required for /api requests.");
  else if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    console.warn("WARNING: listening on a non-local address without TROONOOZ_API_TOKEN; anyone who can reach it can spend your API credits.");
  }
});
