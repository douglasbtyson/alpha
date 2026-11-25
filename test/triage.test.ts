import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareEvidence } from "../src/analysis/evidence.js";
import type { StoryCard } from "../src/knowledge/base.js";
import { claudeTriage, type CreateMessage, type StorySignature } from "../src/knowledge/triage.js";
import { message, photo, testConfig } from "./helpers.js";

type Params = Parameters<CreateMessage>[0];
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const SIG: StorySignature = {
  description: "A photo of a shark swimming beside a car on a flooded highway, captioned as happening now.",
  claims: ["A shark is swimming on the flooded I-95 right now"],
  entities: ["I-95", "Storm Watch Daily"],
  search_terms: "shark flooded highway I-95 hurricane storm",
};

const card = (id: string, extra: Partial<StoryCard> = {}): StoryCard => ({
  id,
  title: "Recycled hoax: doctored shark photo",
  summary: "Shark composited into a flood photo",
  headline: "Recycled hoax: doctored shark photo",
  verdict: "untrustworthy",
  trustScore: 8,
  checks: 2,
  firstSeen: "2026-11-20T00:00:00Z",
  lastChecked: "2026-11-24T00:00:00Z",
  latestReport: "report0001",
  thumbnail: `data:image/jpeg;base64,${Buffer.from("x").toString("base64")}`,
  reusable: true,
  disputed: false,
  focus: [],
  webResearch: true,
  mode: "thorough",
  ...extra,
});

function scriptedCreate(responses: Anthropic.Beta.BetaMessage[]) {
  const calls: Params[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  };
  return { create, calls };
}

const find = { type: "tool_use", id: "f1", name: "find_stories", input: SIG };
const report = (input: object) => ({ type: "tool_use", id: "r1", name: "report_story_match", input });

async function evidence() {
  const big = await sharp(await photo(3, 3000, 2000)).jpeg().toBuffer();
  return prepareEvidence(
    { files: [{ name: "post.jpg", mimeType: "image/jpeg", buffer: big }], frames: [], imageUrls: [], text: "", urls: [], page: null, focus: [], webResearch: true, source: "web" },
    testConfig(),
  );
}

describe("story triage", () => {
  it("stops after one cheap call when no story is similar", async () => {
    const { create, calls } = scriptedCreate([message([find], "tool_use")]);
    const searched: string[] = [];
    const result = await claudeTriage(create, testConfig())(await evidence(), (text) => {
      searched.push(text);
      return [];
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ signature: SIG, candidates: [], verdict: null });
    expect(searched[0]).toContain("shark flooded highway");

    const p = calls[0]!;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.tools!.every((t) => "strict" in t && t.strict)).toBe(true);
    expect(p.fallbacks).toBe("default");
    const img = (p.messages[0]!.content as Anthropic.Beta.BetaContentBlockParam[]).find((b) => b.type === "image") as Anthropic.Beta.BetaImageBlockParam;
    const meta = await sharp(Buffer.from((img.source as { data: string }).data, "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568);
  });

  it("compares candidates (with thumbnails) and accepts a high-confidence match", async () => {
    const { create, calls } = scriptedCreate([
      message([find], "tool_use"),
      message([report({ story_id: "st_a", confidence: "high", reason: "Same doctored shark photo with a new caption." })], "tool_use"),
    ]);
    const result = await claudeTriage(create, testConfig())(await evidence(), () => [card("st_a"), card("st_b")]);
    expect(result.verdict).toEqual({ storyId: "st_a", confidence: "high", reason: "Same doctored shark photo with a new caption." });
    const toolResult = (calls[1]!.messages.at(-1)!.content as ToolResult[])[0]!;
    const parts = toolResult.content as Array<{ type: string; text?: string }>;
    expect(parts.filter((b) => b.type === "image")).toHaveLength(2);
    expect(parts.some((b) => b.text?.includes("[story_id: st_b]"))).toBe(true);
  });

  it("ignores invented story IDs and low confidence", async () => {
    const run = async (input: object) => {
      const { create } = scriptedCreate([message([find], "tool_use"), message([report(input)], "tool_use")]);
      return (await claudeTriage(create, testConfig())(await evidence(), () => [card("st_a")])).verdict;
    };
    expect(await run({ story_id: "st_zzz", confidence: "high", reason: "x" })).toMatchObject({ storyId: null, confidence: "low" });
    expect(await run({ story_id: "st_a", confidence: "low", reason: "x" })).toMatchObject({ storyId: null });
    expect(await run({ story_id: "st_a", confidence: "medium", reason: "x" })).toMatchObject({ storyId: "st_a", confidence: "medium" });
  });

  it("gives up quietly on refusals or when the model skips the tools", async () => {
    const refused = scriptedCreate([message([], "refusal")]);
    expect(await claudeTriage(refused.create, testConfig())(await evidence(), () => [card("st_a")])).toMatchObject({ signature: null, verdict: null });
    const chatty = scriptedCreate([message([{ type: "text", text: "Looks like a shark.", citations: null }], "end_turn")]);
    expect(await claudeTriage(chatty.create, testConfig())(await evidence(), () => [card("st_a")])).toMatchObject({ signature: null, verdict: null });
  });

  it("omits server-side fallbacks for models that don't support them", async () => {
    const { create, calls } = scriptedCreate([message([find], "tool_use")]);
    await claudeTriage(create, testConfig({ triageModel: "claude-haiku-5-5" }))(await evidence(), () => []);
    expect(calls[0]!.model).toBe("claude-haiku-5-5");
    expect(calls[0]!.fallbacks).toBeUndefined();
    expect(calls[0]!.betas).toBeUndefined();
  });
});
