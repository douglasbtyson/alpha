import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { SAMPLE_NEWS_REPORT, SAMPLE_NOTHING_REPORT, SAMPLE_VENDOR_REPORT } from "../src/analysis/demo.js";
import { normalizeReport, ReportSchema } from "../src/analysis/schema.js";

const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"];

function walk(node: unknown, visit: (n: Record<string, unknown>, path: string) => void, path = "$"): void {
  if (Array.isArray(node)) node.forEach((n, i) => walk(n, visit, `${path}[${i}]`));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>, path);
    for (const [k, v] of Object.entries(node)) walk(v, visit, `${path}.${k}`);
  }
}

describe("report schema", () => {
  const schema = betaZodOutputFormat(ReportSchema).schema;

  it("is strict-mode compatible: closed objects with every property required", () => {
    walk(schema, (n, path) => {
      if (n.type === "object" && n.properties) {
        expect(n.additionalProperties, path).toBe(false);
        expect(new Set(n.required as string[]), path).toEqual(new Set(Object.keys(n.properties as object)));
      }
    });
  });

  it("uses no unsupported constraint keywords", () => {
    walk(schema, (n, path) => {
      for (const k of UNSUPPORTED) expect(k in n, `${path}.${k}`).toBe(false);
    });
  });

  it("keeps union-typed fields to the three optional sections", () => {
    let unions = 0;
    walk(schema, (n) => {
      if (Array.isArray(n.anyOf)) unions++;
    });
    expect(unions).toBe(3);
  });

  it("puts the verdict, summary, and background first so they are written (and shown) first", () => {
    expect(Object.keys(schema.properties as object).slice(0, 3)).toEqual(["verdict", "summary", "background"]);
  });

  it("drops empty background sections", () => {
    const r = normalizeReport({
      ...SAMPLE_NEWS_REPORT,
      background: { simple: "  Context.  ", sections: [{ title: "Who", body: "" }, ...SAMPLE_NEWS_REPORT.background.sections] },
    });
    expect(r.background.simple).toBe("Context.");
    expect(r.background.sections).toHaveLength(SAMPLE_NEWS_REPORT.background.sections.length);
  });

  it("accepts the sample reports", () => {
    expect(ReportSchema.safeParse(SAMPLE_NEWS_REPORT).success).toBe(true);
    expect(ReportSchema.safeParse(SAMPLE_VENDOR_REPORT).success).toBe(true);
    expect(ReportSchema.safeParse(SAMPLE_NOTHING_REPORT).success).toBe(true);
  });

  it("asks for the reasons behind every score", () => {
    const verdict = (schema.properties as Record<string, { properties: object; required: string[] }>).verdict!;
    expect(verdict.required).toEqual(expect.arrayContaining(["score_reason", "would_raise"]));
  });

  it("pins 'nothing to verify' verdicts to a neutral score with nothing to raise", () => {
    const r = normalizeReport({
      ...SAMPLE_NOTHING_REPORT,
      verdict: { ...SAMPLE_NOTHING_REPORT.verdict, trust_score: 91, would_raise: "More sources" },
    });
    expect(r.verdict).toMatchObject({ rating: "nothing_to_check", trust_score: 50, would_raise: "" });
  });

  it("normalizeReport clamps and rounds scores and drops empty source URLs", () => {
    const r = normalizeReport({
      ...SAMPLE_NEWS_REPORT,
      verdict: { ...SAMPLE_NEWS_REPORT.verdict, trust_score: 140.6 },
      news: { ...SAMPLE_NEWS_REPORT.news!, score: -5 },
      media: { items: [{ ...SAMPLE_NEWS_REPORT.media!.items[0]!, authenticity_score: 42.4 }] },
      sources: [...SAMPLE_NEWS_REPORT.sources, { title: "x", url: " ", supports: "" }],
    });
    expect(r.verdict.trust_score).toBe(100);
    expect(r.news!.score).toBe(0);
    expect(r.media!.items[0]!.authenticity_score).toBe(42);
    expect(r.sources).toHaveLength(SAMPLE_NEWS_REPORT.sources.length);
  });
});
