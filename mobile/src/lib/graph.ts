/**
 * Turns a report into the evidence map: the post at the centre, a hub for each part of the check
 * (claims, seller, product, media, flags, sources, related checks) around it, and each finding
 * orbiting its hub. Claims are also linked to the sources that back them.
 */
import { CLAIM, CONTENT_TYPES, MEDIA, NEWS, OVERALL, PRODUCT, SEVERITY, VENDOR, hostOf, label, scoreText, scoreTone, type Tone } from "./labels";
import { normalize, scaleVec, tangentBasis, type Vec3 } from "./projection";
import type { AnalysisRecord } from "./types";

export type NodeKind = "post" | "hub" | "leaf";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Which cluster the node belongs to (the hub's id; "post" for the centre). */
  group: string;
  title: string;
  /** A short tag shown next to the title, e.g. "Supported" or "High". */
  badge?: string;
  detail: string;
  tone: Tone;
  /** An emoji shown on hubs. */
  icon?: string;
  /** Shown inside the centre node (the trust score). */
  value?: string;
  url?: string;
  /** Another check to open (related checks). */
  reportId?: string;
  pos: Vec3;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** A link between two findings (a claim and its source) rather than a finding and its hub. */
  cross?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const HUB_RADIUS = 1.2;
export const LEAF_RADIUS = 2.05;
const LIMITS = { claims: 4, media: 4, flags: 5, sources: 8, pros: 3, related: 5 };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();

interface HubSpec {
  node: Omit<GraphNode, "pos" | "kind" | "group">;
  leaves: Omit<GraphNode, "pos" | "kind" | "group">[];
}

export function buildGraph(record: Pick<AnalysisRecord, "id" | "report" | "story">): Graph {
  const r = record.report;
  const hubs: HubSpec[] = [];

  if (r.news) {
    const [badge, tone] = label(NEWS, r.news.rating);
    hubs.push({
      node: {
        id: "news",
        title: "The claims",
        badge: `${badge} · ${r.news.score}`,
        tone: scoreTone(r.news.score),
        icon: "\u{1F4F0}",
        detail: [r.news.source_assessment, r.news.context].filter(Boolean).join(" "),
      },
      leaves: r.news.claims.slice(0, LIMITS.claims).map((c, i) => {
        const [b, t] = label(CLAIM, c.rating);
        return { id: `claim-${i}`, title: clip(c.claim, 90), badge: b, tone: t, detail: c.explanation };
      }),
    });
  }

  if (r.vendor) {
    const [badge] = label(VENDOR, r.vendor.rating);
    hubs.push({
      node: {
        id: "seller",
        title: r.vendor.name || "The seller",
        badge: `${badge} · ${r.vendor.score}`,
        tone: scoreTone(r.vendor.score),
        icon: "\u{1F6CD}\uFE0F",
        detail: [r.vendor.reputation_summary, r.vendor.offer_assessment].filter(Boolean).join(" "),
        url: r.vendor.website ? (/^https?:\/\//i.test(r.vendor.website) ? r.vendor.website : `https://${r.vendor.website}`) : undefined,
      },
      leaves: [],
    });
  }

  if (r.product) {
    const [badge] = label(PRODUCT, r.product.rating);
    hubs.push({
      node: {
        id: "product",
        title: r.product.name || "The product",
        badge: `${badge} · ${r.product.score}`,
        tone: scoreTone(r.product.score),
        icon: "\u{1F4E6}",
        detail: r.product.summary,
      },
      leaves: [
        ...r.product.pros.slice(0, LIMITS.pros).map((p, i) => ({ id: `pro-${i}`, title: clip(p, 60), badge: "Pro", tone: "good" as Tone, detail: p })),
        ...r.product.cons.slice(0, LIMITS.pros).map((c, i) => ({ id: `con-${i}`, title: clip(c, 60), badge: "Con", tone: "warn" as Tone, detail: c })),
      ],
    });
  }

  const media = r.media?.items ?? [];
  if (media.length) {
    const avg = Math.round(media.reduce((s, m) => s + m.authenticity_score, 0) / media.length);
    hubs.push({
      node: { id: "media", title: "Images & video", badge: `Authenticity ${avg}`, tone: scoreTone(avg), icon: "\u{1F5BC}️", detail: `${media.length} item${media.length === 1 ? "" : "s"} checked for editing, AI generation, and original context.` },
      leaves: media.slice(0, LIMITS.media).map((m, i) => {
        const [b, t] = label(MEDIA, m.rating);
        const findings = m.findings.slice(0, 3).map((f) => `• ${f.observation}`);
        return { id: `media-${i}`, title: clip(m.label || m.ref, 60), badge: b, tone: t, detail: [m.provenance, ...findings].filter(Boolean).join("\n") };
      }),
    });
  }

  if (r.red_flags.length) {
    hubs.push({
      node: { id: "red", title: "Red flags", badge: `${r.red_flags.length} found`, tone: "bad", icon: "\u{1F6A9}", detail: "What raised concerns, most serious first." },
      leaves: r.red_flags.slice(0, LIMITS.flags).map((f, i) => {
        const [b, t] = label(SEVERITY, f.severity);
        return { id: `red-${i}`, title: clip(f.description, 70), badge: b, tone: t === "neutral" ? "caution" : t, detail: f.description };
      }),
    });
  }

  const green = r.green_flags ?? [];
  if (green.length) {
    hubs.push({
      node: { id: "green", title: "Green flags", badge: `${green.length} found`, tone: "good", icon: "✅", detail: "What was reassuring." },
      leaves: green.slice(0, LIMITS.flags).map((g, i) => ({ id: `green-${i}`, title: clip(g, 70), tone: "good" as Tone, detail: g })),
    });
  }

  const sources = r.sources.slice(0, LIMITS.sources);
  if (sources.length) {
    hubs.push({
      node: { id: "sources", title: "Sources", badge: `${r.sources.length} cited`, tone: "neutral", icon: "\u{1F517}", detail: "Where the evidence came from. Tap one to open it." },
      leaves: sources.map((s, i) => ({
        id: `source-${i}`,
        title: clip(s.title || hostOf(s.url), 60),
        badge: hostOf(s.url),
        tone: s.seen === false ? "caution" : "neutral",
        detail: s.seen === false ? `${s.supports} (This link didn't come up in this check's research, so treat it with care.)` : s.supports,
        url: s.url,
      })),
    });
  }

  const related = (record.story?.members ?? []).filter((m) => m.id !== record.id).slice(0, LIMITS.related);
  if (related.length) {
    hubs.push({
      node: { id: "related", title: "Related checks", badge: `${related.length} more`, tone: "neutral", icon: "\u{1F9E9}", detail: record.story?.title ? `Other checks of the same story: ${record.story.title}` : "Other checks of the same story." },
      leaves: related.map((m) => ({
        id: `related-${m.id}`,
        title: clip(m.headline, 70),
        badge: scoreText(m.trust_score, m.rating),
        tone: scoreTone(m.trust_score, m.rating),
        detail: label(OVERALL, m.rating)[0],
        reportId: m.id,
      })),
    });
  }

  const [verdictLabel] = label(OVERALL, r.verdict.rating);
  const content = [CONTENT_TYPES[r.content.type] ?? "Content", r.content.platform && `on ${r.content.platform}`].filter(Boolean).join(" ");
  const nodes: GraphNode[] = [
    {
      id: "post",
      kind: "post",
      group: "post",
      title: content,
      badge: verdictLabel,
      tone: scoreTone(r.verdict.trust_score, r.verdict.rating),
      value: scoreText(r.verdict.trust_score, r.verdict.rating),
      detail: [r.content.author && `By ${r.content.author}.`, r.content.description].filter(Boolean).join(" "),
      pos: { x: 0, y: 0, z: 0 },
    },
  ];
  const edges: GraphEdge[] = [];

  // Hubs go round the middle, alternately a little above and below, so the map reads well as it spins.
  hubs.forEach((hub, i) => {
    const theta = (2 * Math.PI * i) / hubs.length;
    const phi = hubs.length < 3 ? 0.3 : (i % 2 === 0 ? 1 : -1) * 0.55;
    const dir = { x: Math.sin(theta) * Math.cos(phi), y: Math.sin(phi), z: Math.cos(theta) * Math.cos(phi) };
    nodes.push({ ...hub.node, kind: "hub", group: hub.node.id, pos: scaleVec(dir, HUB_RADIUS) });
    edges.push({ from: "post", to: hub.node.id });
    const [u, v] = tangentBasis(dir);
    const n = hub.leaves.length;
    hub.leaves.forEach((leaf, j) => {
      // A sunflower spiral around the hub's direction keeps the leaves evenly spaced.
      const spread = n === 1 ? 0 : 0.58 * Math.sqrt((j + 0.5) / n);
      const a = j * GOLDEN_ANGLE;
      const d = normalize({
        x: dir.x + spread * (Math.cos(a) * u.x + Math.sin(a) * v.x),
        y: dir.y + spread * (Math.cos(a) * u.y + Math.sin(a) * v.y),
        z: dir.z + spread * (Math.cos(a) * u.z + Math.sin(a) * v.z),
      });
      nodes.push({ ...leaf, kind: "leaf", group: hub.node.id, pos: scaleVec(d, LEAF_RADIUS) });
      edges.push({ from: hub.node.id, to: leaf.id });
    });
  });

  // Link each claim to the sources it cites.
  r.news?.claims.slice(0, LIMITS.claims).forEach((c, i) => {
    sources.forEach((s, k) => {
      if (c.source_urls.some((u) => sameUrl(u, s.url))) edges.push({ from: `claim-${i}`, to: `source-${k}`, cross: true });
    });
  });

  return { nodes, edges };
}

/** The findings that orbit a hub. */
export function childrenOf(graph: Graph, hubId: string): GraphNode[] {
  const ids = new Set(graph.edges.filter((e) => e.from === hubId && !e.cross).map((e) => e.to));
  return graph.nodes.filter((n) => ids.has(n.id) && n.kind === "leaf");
}

/** The ids connected to `id`, including itself. */
export function neighbours(graph: Graph, id: string): Set<string> {
  const out = new Set([id]);
  for (const e of graph.edges) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return out;
}
