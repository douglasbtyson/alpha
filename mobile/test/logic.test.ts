import { describe, expect, it } from "vitest";
// The server's own sample reports, so the app is tested against the real report shape.
import { SAMPLE_NEWS_REPORT, SAMPLE_NOTHING_REPORT, SAMPLE_VENDOR_REPORT } from "../../src/analysis/demo";
import { HUB_RADIUS, LEAF_RADIUS, buildGraph, neighbours } from "../src/lib/graph";
import { scoreText, scoreTone, timeAgo } from "../src/lib/labels";
import { stepsFrom } from "../src/lib/progress";
import { clampPitch, hitTest, project, rotate, tangentBasis, PITCH_LIMIT } from "../src/lib/projection";
import { incomingServer, normalizeServer, tokenKey } from "../src/lib/server";
import type { JobEvent, Report } from "../src/lib/types";

const record = (report: unknown, extra: Record<string, unknown> = {}) => ({ id: "abc", report: report as Report, story: null, ...extra });

describe("server address", () => {
  it("cleans up what people type", () => {
    expect(normalizeServer("desktop-pk1.tail1.ts.net")).toBe("https://desktop-pk1.tail1.ts.net");
    expect(normalizeServer("  https://desktop-pk1.tail1.ts.net/#/phone ")).toBe("https://desktop-pk1.tail1.ts.net");
    expect(normalizeServer("192.168.1.20:8787")).toBe("http://192.168.1.20:8787");
    expect(normalizeServer("localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeServer("my-pc:8787")).toBe("http://my-pc:8787");
    expect(normalizeServer("http://my-pc.local:8787/")).toBe("http://my-pc.local:8787");
  });

  it("rejects things that aren't web addresses", () => {
    for (const bad of ["", "   ", "javascript:alert(1)", "ftp://x.example", "https://user:pw@x.example", "https://"]) expect(normalizeServer(bad)).toBeNull();
  });

  it("keys tokens by server so one server's token never goes to another", () => {
    expect(tokenKey("https://a.ts.net")).toBe("token.a.ts.net");
    expect(tokenKey("http://192.168.1.2:8787")).toBe("token.192.168.1.2_8787");
    expect(tokenKey("https://a.ts.net")).not.toBe(tokenKey("https://b.ts.net"));
  });

  it("adopts a linked server when none is set, and asks before switching", () => {
    const link = encodeURIComponent("https://pc.tail1.ts.net");
    expect(incomingServer(decodeURIComponent(link), null)).toEqual({ action: "adopt", server: "https://pc.tail1.ts.net" });
    expect(incomingServer("https://pc.tail1.ts.net", "https://pc.tail1.ts.net").action).toBe("none");
    expect(incomingServer("https://evil.example", "https://pc.tail1.ts.net")).toEqual({ action: "confirm", server: "https://evil.example" });
    expect(incomingServer(undefined, "https://pc.tail1.ts.net").action).toBe("none");
    expect(incomingServer(["javascript:alert(1)"], null).action).toBe("none");
  });
});

describe("3D projection", () => {
  const view = { width: 400, height: 600, extent: 2.5, distance: 6 };

  it("puts the centre in the middle and brings nearer points forward and larger", () => {
    const c = project({ x: 0, y: 0, z: 0 }, view);
    expect(c).toMatchObject({ x: 200, y: 300, scale: 1, depth: 0.5 });
    const near = project({ x: 1, y: 1, z: 2 }, view);
    const far = project({ x: 1, y: 1, z: -2 }, view);
    expect(near.scale).toBeGreaterThan(1);
    expect(far.scale).toBeLessThan(1);
    expect(near.depth).toBeGreaterThan(far.depth);
    expect(near.x).toBeGreaterThan(far.x); // perspective spreads nearer points out from the centre
    expect(near.y).toBeLessThan(300); // +y is up on screen
  });

  it("rotates without changing distance from the centre", () => {
    const p = { x: 0.3, y: -1.2, z: 0.8 };
    const q = rotate(p, 1.1, -0.7);
    expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(Math.hypot(p.x, p.y, p.z), 10);
    // Turning a quarter turn brings a point on the right round to the front.
    const front = rotate({ x: -1, y: 0, z: 0 }, Math.PI / 2, 0);
    expect(front.z).toBeCloseTo(1, 10);
  });

  it("limits tilt so the map can't flip upside down", () => {
    expect(clampPitch(5)).toBe(PITCH_LIMIT);
    expect(clampPitch(-5)).toBe(-PITCH_LIMIT);
    expect(clampPitch(0.2)).toBe(0.2);
  });

  it("builds a perpendicular basis for any direction", () => {
    for (const d of [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.6, y: 0.8, z: 0 }]) {
      const [u, v] = tangentBasis(d);
      const dot = (a: typeof d, b: typeof d) => a.x * b.x + a.y * b.y + a.z * b.z;
      expect(dot(u, d)).toBeCloseTo(0, 10);
      expect(dot(v, d)).toBeCloseTo(0, 10);
      expect(dot(u, v)).toBeCloseTo(0, 10);
      expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 10);
    }
  });

  it("picks the front-most node under a tap", () => {
    const pts = [
      { id: "back", x: 100, y: 100, r: 10, depth: 0.2 },
      { id: "front", x: 104, y: 102, r: 10, depth: 0.9 },
      { id: "far", x: 300, y: 300, r: 10, depth: 1 },
    ];
    expect(hitTest(pts, 102, 101)?.id).toBe("front");
    expect(hitTest(pts, 200, 200)).toBeNull();
    expect(hitTest(pts, 312, 300, 14)?.id).toBe("far"); // a small slop makes little dots easy to hit
  });
});

describe("evidence map", () => {
  for (const [name, report] of [
    ["news", SAMPLE_NEWS_REPORT],
    ["vendor", SAMPLE_VENDOR_REPORT],
    ["nothing to check", SAMPLE_NOTHING_REPORT],
  ] as const) {
    it(`lays out a well-formed graph for the ${name} sample`, () => {
      const g = buildGraph(record(report));
      const ids = g.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(g.nodes[0]).toMatchObject({ id: "post", kind: "post", pos: { x: 0, y: 0, z: 0 } });
      for (const e of g.edges) {
        expect(ids).toContain(e.from);
        expect(ids).toContain(e.to);
      }
      for (const n of g.nodes) {
        const r = Math.hypot(n.pos.x, n.pos.y, n.pos.z);
        expect(Number.isFinite(r)).toBe(true);
        if (n.kind === "hub") expect(r).toBeCloseTo(HUB_RADIUS, 6);
        if (n.kind === "leaf") expect(r).toBeCloseTo(LEAF_RADIUS, 6);
        // Every node is reachable from the post.
        if (n.kind !== "post") expect(g.edges.some((e) => e.to === n.id)).toBe(true);
      }
      expect(g.nodes.length).toBeLessThanOrEqual(60);
    });
  }

  it("shows each part of a seller check as its own hub, with the post scored in the middle", () => {
    const g = buildGraph(record(SAMPLE_VENDOR_REPORT));
    const hubs = g.nodes.filter((n) => n.kind === "hub").map((n) => n.id);
    expect(hubs).toEqual(expect.arrayContaining(["seller", "product", "red", "sources"]));
    expect(g.nodes[0]!.value).toBe(String(SAMPLE_VENDOR_REPORT.verdict.trust_score));
    // Hubs are spread out, not stacked.
    const hubNodes = g.nodes.filter((n) => n.kind === "hub");
    for (let i = 0; i < hubNodes.length; i++)
      for (let j = i + 1; j < hubNodes.length; j++) {
        const a = hubNodes[i]!.pos;
        const b = hubNodes[j]!.pos;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.5);
      }
  });

  it("links claims to the sources they cite and keeps source links", () => {
    const g = buildGraph(record(SAMPLE_NEWS_REPORT));
    const cited = SAMPLE_NEWS_REPORT.news!.claims.some((c) => c.source_urls.some((u) => SAMPLE_NEWS_REPORT.sources.some((s) => s.url === u)));
    expect(g.edges.some((e) => e.cross)).toBe(cited);
    const src = g.nodes.find((n) => n.id === "source-0")!;
    expect(src.url).toBe(SAMPLE_NEWS_REPORT.sources[0]!.url);
    expect(neighbours(g, "sources").has("source-0")).toBe(true);
  });

  it("shows no number for nothing-to-check verdicts", () => {
    expect(buildGraph(record(SAMPLE_NOTHING_REPORT)).nodes[0]!.value).toBe("–");
  });

  it("adds related checks of the same story, but not the check itself", () => {
    const story = {
      id: "s1",
      title: "Shark on the highway",
      checks: 3,
      members: [
        { id: "abc", created_at: "2026-11-01T00:00:00Z", headline: "This one", rating: "untrustworthy", trust_score: 10 },
        { id: "def", created_at: "2026-11-02T00:00:00Z", headline: "Earlier check", rating: "untrustworthy", trust_score: 12 },
      ],
    };
    const g = buildGraph(record(SAMPLE_NEWS_REPORT, { story }));
    const related = g.nodes.filter((n) => n.group === "related" && n.kind === "leaf");
    expect(related.map((n) => n.reportId)).toEqual(["def"]);
  });
});

describe("labels and progress", () => {
  it("uses the trust score rubric's bands", () => {
    expect([90, 75, 55, 35, 10].map((s) => scoreTone(s))).toEqual(["good", "ok", "caution", "warn", "bad"]);
    expect(scoreTone(90, "unverifiable")).toBe("neutral");
    expect(scoreText(50, "nothing_to_check")).toBe("–");
  });

  it("says how long ago in plain words", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(timeAgo("2026-11-26T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-26T11:15:00Z", now)).toBe("45 min ago");
    expect(timeAgo("2026-11-25T12:00:00Z", now)).toBe("1 day ago");
  });

  it("turns job events into readable steps without repeats", () => {
    const at = "2026-11-26T12:00:00Z";
    const events: JobEvent[] = [
      { type: "progress", at, event: { type: "status", message: "Preparing evidence" } },
      { type: "progress", at, event: { type: "thinking" } },
      { type: "progress", at, event: { type: "thinking" } },
      { type: "progress", at, event: { type: "search", query: "shark highway" } },
      { type: "progress", at, event: { type: "results", count: 4 } },
      { type: "progress", at, event: { type: "fetch", url: "https://www.snopes.com/x" } },
    ];
    expect(stepsFrom(events).map((s) => s.text)).toEqual(["Preparing evidence", "Reading the material", "Searched: “shark highway”", "Reading snopes.com"]);
  });
});
