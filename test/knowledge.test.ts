import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_NEWS_REPORT, SAMPLE_VENDOR_REPORT } from "../src/analysis/demo.js";
import type { FocusArea, FinalReport, Report } from "../src/analysis/schema.js";
import { ftsQuery, KnowledgeBase } from "../src/knowledge/base.js";
import { imagePrint, textHash, type Fingerprint } from "../src/knowledge/fingerprint.js";
import { extractFindings, formatGroups } from "../src/knowledge/findings.js";
import { ReportStore, type AnalysisRecord } from "../src/server/store.js";
import { postScreenshot } from "./helpers.js";

let dir: string;
let kb: KnowledgeBase;
let seq = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "troonooz-kb-"));
  kb = new KnowledgeBase(dir);
});
afterEach(async () => {
  kb.close();
  await rm(dir, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const T0 = new Date("2026-11-20T12:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

function record(opts: {
  report?: Report;
  prints?: Fingerprint[];
  focus?: FocusArea[];
  web?: boolean;
  demo?: boolean;
  createdAt?: Date;
  disputed?: boolean;
}): AnalysisRecord {
  const report = opts.report ?? SAMPLE_NEWS_REPORT;
  return {
    id: `report${String(++seq).padStart(4, "0")}`,
    created_at: (opts.createdAt ?? T0).toISOString(),
    completed_at: (opts.createdAt ?? T0).toISOString(),
    duration_ms: 1000,
    demo: opts.demo ?? false,
    model: "claude-opus-5-5",
    input: {
      source: "web",
      focus: opts.focus ?? [],
      web_research: opts.web ?? true,
      text_excerpt: "",
      urls: [],
      page: null,
      thumbnails: [],
      notes: [],
      fingerprints: opts.prints ?? [],
    },
    signals: [],
    domains: [],
    report: { ...report, sources: report.sources.map((s) => ({ ...s, seen: true })) } as FinalReport,
    research: { queries: [], fetched: [], urlsSeen: 0, unseenCitedUrls: [] },
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 },
    turns: 1,
    zooms: 0,
    disputed: opts.disputed ? { at: T0.toISOString(), note: "" } : null,
  };
}

const url = (u: string): Fingerprint => ({ ref: "link1", kind: "url", value: u });
const text = (t: string): Fingerprint => ({ ref: "text", kind: "text", value: textHash(t)! });
const req = (over: Partial<Parameters<KnowledgeBase["findMatch"]>[1]> = {}) => ({ focus: [] as FocusArea[], webResearch: true, demo: false, now: at(1), ...over });
const LONG = "This miracle fruit reverses diabetes overnight according to doctors everywhere";

describe("instant matches", () => {
  it("matches the same link and rejects a different one", async () => {
    const rec = record({ prints: [url("example.org/story")] });
    kb.indexReport(rec);
    expect(await kb.findMatch([url("example.org/story")], req())).toMatchObject({ id: rec.id, matchedOn: ["url"] });
    expect(await kb.findMatch([url("example.org/other")], req())).toBeNull();
  });

  it("matches a re-shared screenshot but not a different post in the same layout", async () => {
    const post = await postScreenshot("SHARK on I-95 right now!! Stay inside!! This is crazy everyone share");
    const rec = record({ prints: [(await imagePrint("img1", post))!] });
    kb.indexReport(rec);
    const reshared = (await imagePrint("img1", await sharp(post).resize(828).jpeg({ quality: 70 }).toBuffer()))!;
    const other = (await imagePrint("img1", await postScreenshot("Gas prices will drop to one dollar next week says governor")))!;
    expect((await kb.findMatch([reshared], req()))?.id).toBe(rec.id);
    expect(await kb.findMatch([other], req())).toBeNull();
  });

  it("requires every submitted item to match, but accepts an earlier check that covered more", async () => {
    const rec = record({ prints: [url("example.org/story"), text(LONG)] });
    kb.indexReport(rec);
    expect((await kb.findMatch([url("example.org/story")], req()))?.id).toBe(rec.id);
    expect(await kb.findMatch([url("example.org/story"), text(`${LONG} and more`)], req())).toBeNull();
  });

  it("expires news quickly and sellers slowly", async () => {
    const news = record({ prints: [url("news.example/a")] });
    const vendor = record({ report: SAMPLE_VENDOR_REPORT, prints: [url("shop.example/deal")] });
    kb.indexReport(news);
    kb.indexReport(vendor);
    expect(await kb.findMatch([url("news.example/a")], req({ now: at(23) }))).not.toBeNull();
    expect(await kb.findMatch([url("news.example/a")], req({ now: at(25) }))).toBeNull();
    expect(await kb.findMatch([url("shop.example/deal")], req({ now: at(24 * 10) }))).not.toBeNull();
    expect(await kb.findMatch([url("shop.example/deal")], req({ now: at(24 * 15) }))).toBeNull();
  });

  it("only reuses checks that were at least as thorough and covered the requested focus", async () => {
    kb.indexReport(record({ prints: [url("a.example/x")], web: false }));
    expect(await kb.findMatch([url("a.example/x")], req())).toBeNull();
    expect(await kb.findMatch([url("a.example/x")], req({ webResearch: false }))).not.toBeNull();

    kb.indexReport(record({ prints: [url("b.example/x")], focus: ["vendor"] }));
    expect(await kb.findMatch([url("b.example/x")], req())).toBeNull();
    expect(await kb.findMatch([url("b.example/x")], req({ focus: ["vendor"] }))).not.toBeNull();
    expect(await kb.findMatch([url("b.example/x")], req({ focus: ["news"] }))).toBeNull();

    kb.indexReport(record({ prints: [url("c.example/x")] }));
    expect(await kb.findMatch([url("c.example/x")], req({ focus: ["news", "media"] }))).not.toBeNull();
  });

  it("never reuses disputed or demo reports, and prefers the newest match", async () => {
    const old = record({ prints: [url("d.example/x")], createdAt: at(-2) });
    const newer = record({ prints: [url("d.example/x")], createdAt: at(-1) });
    kb.indexReport(old);
    kb.indexReport(newer);
    expect((await kb.findMatch([url("d.example/x")], req()))?.id).toBe(newer.id);
    kb.dispute(newer.id, "wrong");
    expect((await kb.findMatch([url("d.example/x")], req()))?.id).toBe(old.id);

    kb.indexReport(record({ prints: [url("e.example/x")], demo: true }));
    expect(await kb.findMatch([url("e.example/x")], req())).toBeNull();
    expect(await kb.findMatch([url("e.example/x")], req({ demo: true }))).not.toBeNull();
  });
});

describe("entity findings", () => {
  it("extracts claims, accounts, sellers, and media without storing who submitted", async () => {
    const news = extractFindings(record({ prints: [{ ref: "img1", kind: "image", value: "ab".repeat(32) }] }));
    expect(news.map((f) => f.kind).sort()).toEqual(["claim", "media", "source"]);
    expect(news.find((f) => f.kind === "media")!.key).toBe("ab".repeat(32));
    const vendor = extractFindings(record({ report: SAMPLE_VENDOR_REPORT }));
    expect(vendor.find((f) => f.kind === "vendor")!.key).toBe("luxebags-outlet.example");
    const message = extractFindings(record({ report: { ...SAMPLE_NEWS_REPORT, content: { ...SAMPLE_NEWS_REPORT.content, type: "message" } } }));
    expect(message.some((f) => f.kind === "source")).toBe(false);
  });

  it("finds earlier findings by keywords and domain, with agreement counts", () => {
    kb.indexReport(record({ createdAt: at(-48) }));
    kb.indexReport(record({ createdAt: at(-1), disputed: true }));
    kb.indexReport(record({ report: SAMPLE_VENDOR_REPORT }));

    const claims = kb.search("shark flooded highway", "claim", { demo: false });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: "claim", count: 2, verdicts: { contradicted: 2 }, disputed: true });
    const text = formatGroups(claims, at(0));
    expect(text).toContain("CLAIM:");
    expect(text).toContain("Seen in 2 checks");
    expect(text).toContain("flagged");

    expect(kb.search("luxebags-outlet.example", "any", { demo: false })[0]).toMatchObject({ kind: "vendor", verdict: "likely_scam" });
    expect(kb.search("Storm Watch Daily", "source", { demo: false })[0]?.kind).toBe("source");
    expect(kb.search("shark", "any", { demo: true })).toEqual([]);
  });

  it("survives hostile or empty search input", () => {
    kb.indexReport(record({}));
    expect(ftsQuery('"); DROP TABLE findings; --')).toBe('"drop" OR "table" OR "findings"');
    expect(() => kb.search('"); DROP TABLE findings; -- NEAR(', "any", { demo: false })).not.toThrow();
    expect(kb.search("  !!! ", "any", { demo: false })).toEqual([]);
  });

  it("surfaces related findings for the same content or seller domain", async () => {
    const rec = record({ prints: [url("news.example/a")] });
    kb.indexReport(rec);
    kb.indexReport(record({ report: SAMPLE_VENDOR_REPORT }));
    const byContent = await kb.related([url("news.example/a")], [], { demo: false });
    expect(byContent.map((g) => g.kind).sort()).toEqual(["claim", "media", "source"]);
    const byDomain = await kb.related([], ["luxebags-outlet.example"], { demo: false });
    expect(byDomain).toHaveLength(1);
    expect(byDomain[0]!.kind).toBe("vendor");
  });

  it("removes a deleted report everywhere", async () => {
    const rec = record({ prints: [url("news.example/a")] });
    kb.indexReport(rec);
    kb.removeReport(rec.id);
    expect(await kb.findMatch([url("news.example/a")], req())).toBeNull();
    expect(kb.search("shark", "any", { demo: false })).toEqual([]);
  });
});

describe("maintenance", () => {
  it("caches successful domain lookups for a week", () => {
    kb.saveDomain({ domain: "shop.example", registered: "2026-11-01", ageDays: 19, registrar: "R", error: null }, at(0));
    expect(kb.cachedDomain("shop.example", at(24))?.ageDays).toBe(20);
    expect(kb.cachedDomain("shop.example", at(24 * 8))).toBeNull();
    kb.saveDomain({ domain: "bad.example", registered: null, ageDays: null, registrar: null, error: "HTTP 500" });
    expect(kb.cachedDomain("bad.example")).toBeNull();
  });

  it("rebuilds itself from the saved JSON reports", async () => {
    const store = new ReportStore(dir);
    await store.init();
    await store.save(record({ prints: [url("news.example/a")] }));
    await store.save(record({ report: SAMPLE_VENDOR_REPORT }));
    expect(await kb.syncFrom(store)).toBe(2);
    expect(await kb.syncFrom(store)).toBe(0);
    expect(kb.stats().reports).toBe(2);
  });
});
