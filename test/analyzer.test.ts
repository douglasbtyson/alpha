import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { analyze, AnalysisError, type ProgressEvent } from "../src/analysis/analyzer.js";
import { SAMPLE_NEWS_REPORT } from "../src/analysis/demo.js";
import { prepareEvidence } from "../src/analysis/evidence.js";
import type { AnalysisInput } from "../src/analysis/input.js";
import { NUDGE_SUBMIT } from "../src/analysis/prompts.js";
import { message, scripted, solidPng, testConfig } from "./helpers.js";

type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const config = testConfig();

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    files: [],
    frames: [],
    imageUrls: [],
    text: "",
    urls: [],
    page: null,
    focus: [],
    webResearch: true,
    source: "web",
    ...overrides,
  };
}

const opts = { focus: [], webResearch: true, source: "web", today: "2026-11-23" };

const search = (id: string, query: string, urls: string[]) => [
  { type: "server_tool_use", id, name: "web_search", input: { query } },
  {
    type: "web_search_tool_result",
    tool_use_id: id,
    content: urls.map((url) => ({ type: "web_search_result", url, title: url, encrypted_content: "", page_age: null })),
  },
];
const submit = (report: unknown = SAMPLE_NEWS_REPORT, id = "toolu_submit") => ({ type: "tool_use", id, name: "submit_report", input: report });

async function textEvidence() {
  return prepareEvidence(input({ text: "Shark on the highway right now!" }), config);
}

describe("analyze", () => {
  it("sends a well-formed request and returns a grounded report", async () => {
    const ev = await textEvidence();
    const { streamer, calls } = scripted([
      message([...search("s1", "shark highway hoax", SAMPLE_NEWS_REPORT.sources.map((s) => s.url)), submit()], "tool_use"),
    ]);
    const events: ProgressEvent[] = [];
    const result = await analyze(ev, opts, config, streamer, (e) => events.push(e));

    const p = calls[0]!;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config).toEqual({ effort: "high" });
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.tool_choice).toEqual({ type: "auto" });
    expect(p.max_tokens).toBe(64000);
    const sys = p.system as Array<{ cache_control?: unknown }>;
    expect(sys[0]!.cache_control).toEqual({ type: "ephemeral" });
    const names = p.tools!.map((t) => ("name" in t ? t.name : ""));
    expect(names).toEqual(["web_search", "web_fetch", "submit_report"]); // no images -> no inspect_region
    expect(p.tools!.find((t) => "name" in t && t.name === "web_search")).toMatchObject({ type: "web_search_20260209", max_uses: 8 });
    // The report schema exceeds the API's strict-grammar size limit, so it must not be strict.
    const submitTool = p.tools!.find((t) => "name" in t && t.name === "submit_report") as Anthropic.Beta.BetaTool;
    expect(submitTool.strict).toBeUndefined();
    const userContent = p.messages[0]!.content as Array<{ type: string; text?: string; cache_control?: unknown }>;
    expect(userContent[0]!.text).toContain("Today's date: 2026-11-23");
    expect(userContent.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(userContent.some((b) => b.text?.includes("<user_text>"))).toBe(true);

    expect(result.report.verdict.trust_score).toBe(8);
    expect(result.report.sources.every((s) => s.seen)).toBe(true);
    expect(result.research.queries).toEqual(["shark highway hoax"]);
    expect(result.usage.input_tokens).toBe(100);
    expect(events.map((e) => e.type)).toEqual(["search", "results", "writing", "draft"]);
  });

  it("runs quick checks with medium effort, few searches, no zooming, and a brevity instruction", async () => {
    const ev = await prepareEvidence(input({ files: [{ name: "p.png", mimeType: "image/png", buffer: await solidPng(400, 300, "#00aa00") }] }), config);
    const { streamer, calls } = scripted([message([submit()], "tool_use")]);
    await analyze(ev, { ...opts, mode: "quick" }, config, streamer);
    const p = calls[0]!;
    expect(p.output_config).toEqual({ effort: "medium" });
    const tools = p.tools!.map((t) => ("name" in t ? t.name : ""));
    expect(tools).toEqual(["web_search", "web_fetch", "submit_report"]);
    expect(p.tools!.find((t) => "name" in t && t.name === "web_search")).toMatchObject({ max_uses: 3 });
    expect(p.tools!.find((t) => "name" in t && t.name === "web_fetch")).toMatchObject({ max_uses: 1 });
    expect(JSON.stringify(p.messages[0]!.content)).toContain("Quick check requested");
  });

  it("streams the verdict while the report is written and times both phases", async () => {
    const ev = await textEvidence();
    // Claude writes fields in schema order, which puts the verdict first.
    const { verdict, summary, ...rest } = SAMPLE_NEWS_REPORT;
    const { streamer } = scripted([message([submit({ verdict, summary, ...rest })], "tool_use")]);
    const events: ProgressEvent[] = [];
    const result = await analyze(ev, opts, config, streamer, (e) => events.push(e));
    const drafts = events.filter((e): e is Extract<ProgressEvent, { type: "draft" }> => e.type === "draft");
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts[0]!.draft).toMatchObject({ rating: "untrustworthy" });
    expect(events.findIndex((e) => e.type === "writing")).toBeLessThan(events.findIndex((e) => e.type === "draft"));
    expect(result.timing.research_ms).toBeGreaterThanOrEqual(0);
    expect(result.timing.writing_ms).toBeGreaterThanOrEqual(0);
  });

  it("omits web tools and fallbacks when disabled", async () => {
    const ev = await textEvidence();
    const { streamer, calls } = scripted([message([submit()], "tool_use")]);
    await analyze(ev, { ...opts, webResearch: false }, testConfig({ fallbacks: false }), streamer);
    const p = calls[0]!;
    expect(p.tools!.map((t) => ("name" in t ? t.name : ""))).toEqual(["submit_report"]);
    expect(p.betas).toBeUndefined();
    expect(p.fallbacks).toBeUndefined();
    const text = JSON.stringify(p.messages[0]!.content);
    expect(text).toContain("Web research is disabled");
  });

  it("flags cited URLs the research never surfaced", async () => {
    const ev = await textEvidence();
    const { streamer } = scripted([message([...search("s1", "q", [SAMPLE_NEWS_REPORT.sources[0]!.url]), submit()], "tool_use")]);
    const result = await analyze(ev, opts, config, streamer);
    expect(result.report.sources.map((s) => s.seen)).toEqual([true, false]);
    expect(result.research.unseenCitedUrls).toEqual([SAMPLE_NEWS_REPORT.sources[1]!.url]);
  });

  it("resumes a paused server-tool turn without adding a user message", async () => {
    const ev = await textEvidence();
    const paused = message(search("s1", "q", ["https://a.example"]), "pause_turn");
    const { streamer, calls } = scripted([paused, message([submit()], "tool_use")]);
    const result = await analyze(ev, opts, config, streamer);
    expect(result.turns).toBe(2);
    const second = calls[1]!.messages;
    expect(second).toHaveLength(2);
    expect(second[1]!.role).toBe("assistant");
    expect(second[1]!.content).toEqual(paused.content);
  });

  it("nudges once when the model ends without submitting", async () => {
    const ev = await textEvidence();
    const { streamer, calls } = scripted([message([{ type: "text", text: "It is fake.", citations: null }], "end_turn"), message([submit()], "tool_use")]);
    const result = await analyze(ev, opts, config, streamer);
    expect(result.turns).toBe(2);
    expect(calls[1]!.messages.at(-1)).toEqual({ role: "user", content: NUDGE_SUBMIT });
  });

  it("gives up after repeated nudges", async () => {
    const ev = await textEvidence();
    const idle = () => message([{ type: "text", text: "Hmm.", citations: null }], "end_turn");
    const { streamer } = scripted([idle, idle, idle]);
    await expect(analyze(ev, opts, config, streamer)).rejects.toMatchObject({ code: "incomplete" });
  });

  it("returns validation errors for a malformed report and accepts the corrected one", async () => {
    const ev = await textEvidence();
    const bad = { ...SAMPLE_NEWS_REPORT, verdict: { rating: "great" } };
    const { streamer, calls } = scripted([message([submit(bad, "t1")], "tool_use"), message([submit(SAMPLE_NEWS_REPORT, "t2")], "tool_use")]);
    const result = await analyze(ev, opts, config, streamer);
    expect(result.turns).toBe(2);
    const feedback = calls[1]!.messages.at(-1)!.content as ToolResult[];
    expect(feedback[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: true });
    expect(String(feedback[0]!.content)).toContain("verdict");
  });

  it("serves inspect_region zoom-ins from the original image", async () => {
    const ev = await prepareEvidence(input({ files: [{ name: "post.png", mimeType: "image/png", buffer: await solidPng(800, 600, "#00aa00") }] }), config);
    const zoom = { type: "tool_use", id: "z1", name: "inspect_region", input: { image_id: "img1", x: 10, y: 20, width: 100, height: 50, reason: "check hands" } };
    const { streamer, calls } = scripted([message([zoom], "tool_use"), message([submit()], "tool_use")]);
    const events: ProgressEvent[] = [];
    const result = await analyze(ev, opts, config, streamer, (e) => events.push(e));
    const zoomTool = calls[0]!.tools!.find((t) => "name" in t && t.name === "inspect_region") as Anthropic.Beta.BetaTool;
    expect(zoomTool.strict).toBe(true);
    const results = calls[1]!.messages.at(-1)!.content as ToolResult[];
    expect(results[0]!.tool_use_id).toBe("z1");
    expect(results[0]!.is_error).toBeUndefined();
    const parts = results[0]!.content as Array<{ type: string }>;
    expect(parts.map((b) => b.type)).toEqual(["text", "image"]);
    expect(result.zooms).toBe(1);
    expect(events).toContainEqual({ type: "zoom", image: "img1", reason: "check hands" });
  });

  it("rejects zooms into unknown images and past the zoom budget", async () => {
    const ev = await prepareEvidence(input({ files: [{ name: "p.png", mimeType: "image/png", buffer: await solidPng(200, 200) }] }), config);
    const z = (id: string, image: string) => ({ type: "tool_use", id, name: "inspect_region", input: { image_id: image, x: 0, y: 0, width: 50, height: 50, reason: "r" } });
    const { streamer, calls } = scripted([message([z("a", "img9"), z("b", "img1"), z("c", "img1")], "tool_use"), message([submit()], "tool_use")]);
    await analyze(ev, opts, testConfig({ maxZooms: 1 }), streamer);
    const results = calls[1]!.messages.at(-1)!.content as ToolResult[];
    expect(results.map((r) => r.is_error ?? false)).toEqual([true, false, true]);
    expect(String(results[0]!.content)).toContain("Unknown image_id");
    expect(String(results[2]!.content)).toContain("Zoom limit");
  });

  it("lets the model look up earlier findings and counts their sources as researched", async () => {
    const ev = await textEvidence();
    ev.priorFindings = "1. CLAIM: Shark on the highway \u2192 contradicted.";
    const searches: Array<[string, string]> = [];
    const knowledge = {
      search: (query: string, kind: string) => {
        searches.push([query, kind]);
        return { text: "1. CLAIM: ...", urls: [SAMPLE_NEWS_REPORT.sources[1]!.url], count: 1 };
      },
      priorUrls: [SAMPLE_NEWS_REPORT.sources[0]!.url],
    };
    const lookup = { type: "tool_use", id: "l1", name: "lookup_prior_findings", input: { query: "shark highway", kind: "claim" } };
    const { streamer, calls } = scripted([message([lookup], "tool_use"), message([submit()], "tool_use")]);
    const events: ProgressEvent[] = [];
    const result = await analyze(ev, { ...opts, knowledge }, config, streamer, (e) => events.push(e));

    expect(calls[0]!.tools!.map((t) => ("name" in t ? t.name : ""))).toEqual(["web_search", "web_fetch", "lookup_prior_findings", "submit_report"]);
    expect(JSON.stringify(calls[0]!.messages[0]!.content)).toContain("Prior troonooz findings");
    expect(searches).toEqual([["shark highway", "claim"]]);
    const results = calls[1]!.messages.at(-1)!.content as ToolResult[];
    expect(String(results[0]!.content)).toContain("1 earlier finding");
    expect(events).toContainEqual({ type: "lookup", query: "shark highway" });
    expect(result.research.lookups).toEqual(["shark highway"]);
    // Both cited sources came from earlier findings rather than this run's web research.
    expect(result.report.sources.every((s) => s.seen)).toBe(true);
  });

  it("raises a refusal with its category", async () => {
    const ev = await textEvidence();
    const { streamer } = scripted([message([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: null } as never })]);
    const err = await analyze(ev, opts, config, streamer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err).toMatchObject({ code: "refusal" });
    expect((err as Error).message).toContain("cyber");
  });

  it("never acts on a tool call truncated by max_tokens", async () => {
    const ev = await textEvidence();
    const { streamer } = scripted([message([submit()], "max_tokens")]);
    await expect(analyze(ev, opts, config, streamer)).rejects.toMatchObject({ code: "incomplete" });
  });
});
