import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { Streamer, StreamHooks } from "../src/analysis/analyzer.js";
import type { Config } from "../src/config.js";

type BetaMessage = Anthropic.Beta.BetaMessage;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type Params = Parameters<Streamer>[0];

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    model: "claude-opus-5-5",
    effort: "high",
    fallbacks: true,
    webSearchMaxUses: 8,
    webFetchMaxUses: 5,
    maxZooms: 6,
    rdap: false,
    knowledge: true,
    storyTriage: true,
    triageModel: "claude-opus-5-5",
    dataDir: "data",
    apiToken: null,
    demo: false,
    maxFiles: 20,
    maxFileBytes: 50 * 1024 * 1024,
    maxImages: 40,
    videoFrames: 4,
    maxConcurrent: 3,
    ...overrides,
  };
}

export function message(content: unknown[], stop: BetaMessage["stop_reason"], extra: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: content as ContentBlock[],
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
      service_tier: "standard",
      speed: null,
    },
    ...extra,
  } as BetaMessage;
}

/**
 * A streamer that replays scripted responses and records a snapshot of every
 * request (the analyzer mutates its messages array between turns).
 */
export function scripted(responses: Array<BetaMessage | ((params: Params) => BetaMessage)>) {
  const calls: Params[] = [];
  let i = 0;
  const streamer: Streamer = async (params: Params, hooks: StreamHooks) => {
    calls.push(structuredClone(params));
    const next = responses[i++];
    if (!next) throw new Error(`scripted streamer ran out of responses at call ${i}`);
    const msg = typeof next === "function" ? next(params) : next;
    for (const block of msg.content) {
      hooks.onBlockStart?.(block);
      hooks.onBlock?.(block);
    }
    return msg;
  };
  return { streamer, calls };
}

export async function solidPng(width: number, height: number, color = "#3366cc"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

export async function solidJpeg(width: number, height: number, color = "#3366cc"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

/** A photo-like image: random overlapping circles (deterministic per seed). */
export async function photo(seed: number, width = 800, height = 600): Promise<Buffer> {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const circles = Array.from(
    { length: 30 },
    () =>
      `<circle cx="${rnd() * width}" cy="${rnd() * height}" r="${20 + rnd() * 150}" fill="rgb(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0})"/>`,
  ).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#888"/>${circles}</svg>`))
    .png()
    .toBuffer();
}

/** A fake social-post screenshot: same layout every time, only the text and price differ. */
export async function postScreenshot(text: string, price = "$9.99"): Promise<Buffer> {
  const lines = (text.match(/.{1,40}/g) ?? [])
    .map((l, i) => `<text x="30" y="${120 + i * 34}" font-size="26" font-family="sans-serif">${l}</text>`)
    .join("");
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="1400"><rect width="100%" height="100%" fill="#fff"/><circle cx="60" cy="50" r="28" fill="#1d9bf0"/><text x="100" y="58" font-size="26" font-weight="bold" font-family="sans-serif">Storm Watch Daily</text>${lines}<text x="30" y="560" font-size="40" font-family="sans-serif">${price}</text><rect x="30" y="600" width="1110" height="620" rx="20" fill="#7aa"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}
