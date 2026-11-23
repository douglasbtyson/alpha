import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SAMPLE_NEWS_REPORT } from "../src/analysis/demo.js";
import { applyGrounding, canonicalUrl, UrlLedger } from "../src/analysis/grounding.js";

type Block = Anthropic.Beta.BetaContentBlock;

describe("canonicalUrl", () => {
  it("ignores scheme, www, trailing slash, fragments and tracking params", () => {
    expect(canonicalUrl("https://www.Example.org/a/b/?utm_source=x&id=3#top")).toBe("example.org/a/b?id=3");
    expect(canonicalUrl("http://example.org/a/b?id=3")).toBe("example.org/a/b?id=3");
    expect(canonicalUrl("not a url")).toBeNull();
  });
});

describe("UrlLedger", () => {
  it("collects URLs from search results, fetches, citations, and tool stdout but not the model's own tool input", () => {
    const ledger = new UrlLedger();
    ledger.collect([
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "shark highway" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", url: "https://a.example/one", title: "One", encrypted_content: "zzz", page_age: null }],
      },
      { type: "server_tool_use", id: "s2", name: "web_fetch", input: { url: "https://b.example/page" } },
      {
        type: "web_fetch_tool_result",
        tool_use_id: "s2",
        content: { type: "web_fetch_result", url: "https://b.example/page", retrieved_at: null, content: { type: "document" } },
      },
      {
        type: "bash_code_execution_tool_result",
        tool_use_id: "s3",
        content: { type: "bash_code_execution_result", stdout: "see https://c.example/x and more", stderr: "", return_code: 0 },
      },
      {
        type: "text",
        text: "per the source",
        citations: [{ type: "web_search_result_location", url: "https://d.example/cited", title: "D", cited_text: "", encrypted_index: "" }],
      },
      { type: "tool_use", id: "t1", name: "submit_report", input: { sources: [{ url: "https://invented.example/fake" }] } },
    ] as unknown as Block[]);
    expect(ledger.queries).toEqual(["shark highway"]);
    expect(ledger.fetched).toEqual(["https://b.example/page"]);
    for (const u of ["https://a.example/one", "https://b.example/page", "https://c.example/x", "https://d.example/cited"]) {
      expect(ledger.has(u), u).toBe(true);
    }
    expect(ledger.has("https://invented.example/fake")).toBe(false);
    expect(ledger.has("https://a.example/one?utm_campaign=z")).toBe(true);
  });

  it("flags cited sources that never appeared in research", () => {
    const ledger = new UrlLedger();
    ledger.add(SAMPLE_NEWS_REPORT.sources[0]!.url);
    const { report, unseen } = applyGrounding(SAMPLE_NEWS_REPORT, ledger, ["https://user.example/submitted"]);
    expect(report.sources.map((s) => s.seen)).toEqual([true, false]);
    expect(unseen).toEqual([SAMPLE_NEWS_REPORT.sources[1]!.url]);
    expect(ledger.has("https://user.example/submitted")).toBe(true);
  });
});
