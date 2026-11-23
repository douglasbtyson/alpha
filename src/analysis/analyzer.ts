import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { Config } from "../config.js";
import { buildUserContent, type EvidenceImage, type PreparedEvidence } from "./evidence.js";
import { applyGrounding, UrlLedger } from "./grounding.js";
import { zoomCrop } from "./images.js";
import { NUDGE_SUBMIT, SYSTEM_PROMPT } from "./prompts.js";
import { normalizeReport, ReportSchema, type FinalReport, type FocusArea } from "./schema.js";

type MessageParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.BetaMessage;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolUnion = Anthropic.Beta.BetaToolUnion;

/** Live progress surfaced to the UI while an analysis runs. */
export type ProgressEvent =
  | { type: "status"; message: string }
  | { type: "thinking" }
  | { type: "search"; query: string }
  | { type: "fetch"; url: string }
  | { type: "results"; count: number }
  | { type: "zoom"; image: string; reason: string }
  | { type: "writing" }
  | { type: "fallback"; from: string; to: string };

export interface StreamHooks {
  onBlockStart?: (block: ContentBlock) => void;
  onBlock?: (block: ContentBlock) => void;
}

/**
 * Sends one streaming request and resolves with the complete message. The
 * indirection lets tests substitute a scripted model.
 */
export type Streamer = (params: MessageParams, hooks: StreamHooks) => Promise<BetaMessage>;

export function anthropicStreamer(client: Anthropic): Streamer {
  return async (params, hooks) => {
    const stream = client.beta.messages.stream(params);
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start") hooks.onBlockStart?.(event.content_block);
    });
    stream.on("contentBlock", (block) => hooks.onBlock?.(block));
    return await stream.finalMessage();
  };
}

export type AnalysisErrorCode = "refusal" | "incomplete" | "invalid_output";

export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
}

export interface AnalysisResult {
  report: FinalReport;
  model: string;
  turns: number;
  zooms: number;
  research: { queries: string[]; fetched: string[]; urlsSeen: number; unseenCitedUrls: string[] };
  usage: UsageTotals;
}

export interface AnalyzeOptions {
  focus: FocusArea[];
  webResearch: boolean;
  source: string;
  today?: string;
}

const MAX_TURNS = 16;
const MAX_NUDGES = 2;
const MAX_INVALID_REPORTS = 2;
const MAX_TOKENS = 64_000;

const SUBMIT_TOOL = "submit_report";
const ZOOM_TOOL = "inspect_region";

const ZoomInput = z.object({
  image_id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  reason: z.string(),
});

function buildTools(config: Config, webResearch: boolean, zoomable: boolean): ToolUnion[] {
  const tools: ToolUnion[] = [];
  if (webResearch && config.webSearchMaxUses > 0) {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: config.webSearchMaxUses });
  }
  if (webResearch && config.webFetchMaxUses > 0) {
    tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: config.webFetchMaxUses });
  }
  if (zoomable && config.maxZooms > 0) {
    tools.push({
      name: ZOOM_TOOL,
      description:
        "Zoom into a rectangular region of a submitted image or video frame at full original resolution. " +
        "Coordinates are pixels in the image as you were shown it (its stated width x height), origin at the top-left. " +
        "Small regions are magnified with nearest-neighbor scaling, so compression artifacts and edges are shown as they are, not smoothed. " +
        "Use it to examine fine details: hands, faces, text, edges, reflections, UI elements, logos.",
      strict: true,
      eager_input_streaming: true,
      input_schema: {
        type: "object",
        properties: {
          image_id: { type: "string", description: 'Evidence ID of the image, e.g. "img1", "img2.1", "vid1.f3".' },
          x: { type: "integer", description: "Left edge of the region." },
          y: { type: "integer", description: "Top edge of the region." },
          width: { type: "integer", description: "Region width." },
          height: { type: "integer", description: "Region height." },
          reason: { type: "string", description: "What you are checking, in a few words." },
        },
        required: ["image_id", "x", "y", "width", "height", "reason"],
        additionalProperties: false,
      },
    });
  }
  tools.push({
    name: SUBMIT_TOOL,
    description:
      "Submit the final troonooz assessment. Call exactly once, after your investigation, with every field filled. " +
      "This ends the analysis.",
    strict: true,
    eager_input_streaming: true,
    input_schema: betaZodOutputFormat(ReportSchema).schema as Anthropic.Beta.BetaTool.InputSchema,
  });
  return tools;
}

function zodSummary(err: z.ZodError): string {
  return err.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Run one verification analysis. A manual agentic loop: Claude reads the
 * evidence, runs server-side web search/fetch, may zoom into images through
 * our inspect_region tool, and finishes by calling submit_report.
 */
export async function analyze(
  evidence: PreparedEvidence,
  options: AnalyzeOptions,
  config: Config,
  streamer: Streamer,
  progress: (e: ProgressEvent) => void = () => {},
): Promise<AnalysisResult> {
  const zoomable = evidence.images.length > 0;
  const tools = buildTools(config, options.webResearch, zoomable);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const imagesById = new Map<string, EvidenceImage>(evidence.images.map((i) => [i.id, i]));

  const messages: MessageParam[] = [
    {
      role: "user",
      content: buildUserContent(evidence, {
        focus: options.focus,
        webResearch: options.webResearch,
        zoomAvailable: zoomable && config.maxZooms > 0,
        source: options.source,
        today,
      }),
    },
  ];

  const baseParams = {
    model: config.model,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" as const },
    output_config: { effort: config.effort },
    // Tools render before system, so this breakpoint caches tools + system.
    system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
    // Auto-cache the growing conversation so continuation turns re-read evidence and search results from cache.
    cache_control: { type: "ephemeral" as const },
    tools,
    tool_choice: { type: "auto" as const },
    ...(config.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };

  const ledger = new UrlLedger();
  const usage: UsageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    web_search_requests: 0,
    web_fetch_requests: 0,
  };
  let nudges = 0;
  let invalidReports = 0;
  let zooms = 0;
  let announcedThinking = false;

  const hooks: StreamHooks = {
    onBlockStart: (block) => {
      if (block.type === "thinking" && !announcedThinking) {
        announcedThinking = true;
        progress({ type: "thinking" });
      } else if (block.type === "tool_use" && block.name === SUBMIT_TOOL) {
        progress({ type: "writing" });
      }
    },
    onBlock: (block) => {
      if (block.type === "server_tool_use") {
        const input = block.input as Record<string, unknown>;
        if (block.name === "web_search" && typeof input.query === "string") progress({ type: "search", query: input.query });
        if (block.name === "web_fetch" && typeof input.url === "string") progress({ type: "fetch", url: input.url });
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        progress({ type: "results", count: block.content.length });
      } else if (block.type === "fallback") {
        progress({ type: "fallback", from: block.from.model, to: block.to.model });
      }
    },
  };

  const runZoom = async (block: ToolUse): Promise<ToolResult> => {
    const parsed = ZoomInput.safeParse(block.input);
    if (!parsed.success) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Invalid input: ${zodSummary(parsed.error)}` };
    }
    if (zooms >= config.maxZooms) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        is_error: true,
        content: "Zoom limit reached for this analysis. Continue with what you have and submit your report.",
      };
    }
    const img = imagesById.get(parsed.data.image_id);
    if (!img) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        is_error: true,
        content: `Unknown image_id "${parsed.data.image_id}". Valid IDs: ${[...imagesById.keys()].join(", ")}`,
      };
    }
    zooms++;
    progress({ type: "zoom", image: img.id, reason: parsed.data.reason });
    try {
      const crop = await zoomCrop(img.original, img, parsed.data);
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: [
          {
            type: "text",
            text: `${img.id}: region x=${parsed.data.x} y=${parsed.data.y} w=${parsed.data.width} h=${parsed.data.height} (original pixels ${crop.crop.width}x${crop.crop.height} at ${crop.crop.left},${crop.crop.top}), shown at ${crop.width}x${crop.height}.`,
          },
          { type: "image", source: { type: "base64", media_type: crop.mediaType, data: crop.data.toString("base64") } },
        ],
      };
    } catch (err) {
      return { type: "tool_result", tool_use_id: block.id, is_error: true, content: `Could not crop: ${(err as Error).message}` };
    }
  };

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const msg = await streamer({ ...baseParams, messages }, hooks);

    usage.input_tokens += msg.usage.input_tokens;
    usage.output_tokens += msg.usage.output_tokens;
    usage.cache_read_input_tokens += msg.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens ?? 0;
    usage.web_search_requests += msg.usage.server_tool_use?.web_search_requests ?? 0;
    usage.web_fetch_requests += msg.usage.server_tool_use?.web_fetch_requests ?? 0;
    ledger.collect(msg.content);

    if (msg.stop_reason === "refusal") {
      const category = msg.stop_details?.category;
      throw new AnalysisError(
        "refusal",
        `The model declined to analyze this material${category ? ` (safety category: ${category})` : ""}. ` +
          "This can happen with graphic, hazardous, or otherwise sensitive content.",
      );
    }

    const toolUses = msg.content.filter((b): b is ToolUse => b.type === "tool_use");
    if (msg.stop_reason === "max_tokens" && toolUses.length > 0) {
      // A truncated tool input can still parse; never act on it.
      throw new AnalysisError("incomplete", "The model's output was cut off before the report was complete. Try again with less material.");
    }

    const submit = toolUses.find((t) => t.name === SUBMIT_TOOL);
    if (submit) {
      const parsed = ReportSchema.safeParse(submit.input);
      if (parsed.success) {
        const { report, unseen } = applyGrounding(normalizeReport(parsed.data), ledger, [
          ...evidence.urls,
          ...(evidence.page?.url ? [evidence.page.url] : []),
          ...(evidence.page?.canonical ? [evidence.page.canonical] : []),
          ...(evidence.page?.link_url ? [evidence.page.link_url] : []),
          ...evidence.remoteImages.map((r) => r.url),
        ]);
        return {
          report,
          model: msg.model,
          turns: turn,
          zooms,
          research: { queries: ledger.queries, fetched: ledger.fetched, urlsSeen: ledger.size, unseenCitedUrls: unseen },
          usage,
        };
      }
      if (++invalidReports > MAX_INVALID_REPORTS) {
        throw new AnalysisError("invalid_output", `The model's report did not match the expected format: ${zodSummary(parsed.error)}`);
      }
      const results: ContentBlockParam[] = [];
      for (const t of toolUses) {
        results.push(
          t.name === SUBMIT_TOOL
            ? {
                type: "tool_result",
                tool_use_id: t.id,
                is_error: true,
                content: `The report failed validation: ${zodSummary(parsed.error)}. Call submit_report again with a corrected, complete report.`,
              }
            : { type: "tool_result", tool_use_id: t.id, is_error: true, content: "Not run: a report was submitted in the same turn." },
        );
      }
      messages.push({ role: "assistant", content: msg.content }, { role: "user", content: results });
      continue;
    }

    if (msg.stop_reason === "pause_turn") {
      // A long server-tool turn paused; send it back unchanged and the server resumes it.
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }

    if (toolUses.length > 0) {
      const results: ContentBlockParam[] = await Promise.all(
        toolUses.map(
          async (t): Promise<ToolResult> =>
            t.name === ZOOM_TOOL
              ? runZoom(t)
              : { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Unknown tool "${t.name}".` },
        ),
      );
      if (turn >= MAX_TURNS - 2) results.push({ type: "text", text: NUDGE_SUBMIT });
      messages.push({ role: "assistant", content: msg.content }, { role: "user", content: results });
      continue;
    }

    // Ended (or ran out of tokens) without submitting a report.
    if (++nudges > MAX_NUDGES) {
      throw new AnalysisError("incomplete", "The model finished without submitting a report.");
    }
    progress({ type: "status", message: "Asking the model to finalize its report" });
    messages.push({ role: "assistant", content: msg.content }, { role: "user", content: NUDGE_SUBMIT });
  }
  throw new AnalysisError("incomplete", `The analysis did not finish within ${MAX_TURNS} model turns.`);
}
