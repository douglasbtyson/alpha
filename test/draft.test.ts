import { describe, expect, it } from "vitest";
import { extractDraft } from "../src/analysis/draft.js";
import { SAMPLE_NEWS_REPORT } from "../src/analysis/demo.js";

const { verdict, summary, ...rest } = SAMPLE_NEWS_REPORT;
const JSON_TEXT = JSON.stringify({ verdict, summary, ...rest });

describe("extractDraft", () => {
  it("returns nothing before any useful field has arrived", () => {
    expect(extractDraft("")).toBeNull();
    expect(extractDraft('{"verdict": {"rat')).toBeNull();
  });

  it("shows fields as they complete, never a half-written number or label", () => {
    const at = (needle: string, extra = 0) => extractDraft(JSON_TEXT.slice(0, JSON_TEXT.indexOf(needle) + extra));
    expect(at('"trust_score"')).toMatchObject({ rating: "untrustworthy", trust_score: null });
    expect(at('"trust_score":8', 13)).toMatchObject({ trust_score: null }); // "8" could still become "85"
    expect(at('"confidence"')).toMatchObject({ trust_score: 8 });
    const partial = at('"summary"', 40)!;
    expect(partial.headline).toBe(verdict.headline);
    expect(partial.summary.length).toBeGreaterThan(0);
    expect(summary.startsWith(partial.summary)).toBe(true);
    expect(extractDraft(JSON_TEXT)).toEqual({ rating: "untrustworthy", trust_score: 8, confidence: "high", headline: verdict.headline, summary });
  });

  it("decodes escapes and ignores look-alike keys", () => {
    const d = extractDraft('{"vendor":{"reputation_summary":"no"},"verdict":{"headline":"Say \\"hi\\"\\n\\u00e9"},"summary":"ok"}');
    expect(d).toMatchObject({ headline: 'Say "hi"\né', summary: "ok" });
  });

  it("never throws on garbage", () => {
    for (const junk of ['{"verdict":{"headline":"\\', '"summary":"\\u12', "}}}{{{", '{"verdict":{"trust_score":1e999,']) {
      expect(() => extractDraft(junk)).not.toThrow();
    }
  });
});
