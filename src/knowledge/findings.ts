import { getDomain } from "tldts";
import type { AnalysisRecord } from "../server/store.js";
import { normalizeText } from "./fingerprint.js";

/**
 * Entities pulled from a finished report, deterministically (no model call):
 * the claims it checked, the vendor, the account or outlet, and each media item.
 * Only conclusions are stored, never the submitted screenshots or who sent them.
 */

export type FindingKind = "claim" | "vendor" | "source" | "media";
export const FINDING_KINDS: readonly FindingKind[] = ["claim", "vendor", "source", "media"];

export interface FindingRow {
  kind: FindingKind;
  /** Grouping key: normalized claim text, vendor domain or name, platform+account, or image hash. */
  key: string;
  /** Evidence ID within its report (media only). */
  ref: string | null;
  title: string;
  verdict: string;
  score: number | null;
  summary: string;
  details: Record<string, unknown>;
}

/** Registrable domain of a URL or bare hostname, if it has one. */
export function domainKey(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const host = /^https?:\/\//i.test(v) ? new URL(v).hostname : v.split("/")[0]!;
    return getDomain(host) ?? null;
  } catch {
    return null;
  }
}

function baseRef(ref: string): string | null {
  const m = ref.match(/\b((?:img|vid)\d+)/);
  return m ? m[1]! : null;
}

export function extractFindings(rec: AnalysisRecord): FindingRow[] {
  const r = rec.report;
  const rows: FindingRow[] = [];

  for (const c of r.news?.claims ?? []) {
    const key = normalizeText(c.claim).slice(0, 400);
    if (!key) continue;
    rows.push({
      kind: "claim",
      key,
      ref: null,
      title: c.claim,
      verdict: c.rating,
      score: null,
      summary: c.explanation,
      details: { source_urls: c.source_urls, news_rating: r.news!.rating, platform: r.content.platform, author: r.content.author },
    });
  }

  // Private messages often name ordinary people; don't turn their senders into shared entities.
  if (r.content.author && r.content.type !== "message") {
    const key = normalizeText(`${r.content.platform} ${r.content.author}`);
    if (key) {
      rows.push({
        kind: "source",
        key,
        ref: null,
        title: r.content.platform ? `${r.content.author} (${r.content.platform})` : r.content.author,
        verdict: r.news?.rating ?? r.verdict.rating,
        score: r.news?.score ?? r.verdict.trust_score,
        summary: r.news?.source_assessment || r.summary,
        details: { platform: r.content.platform, author: r.content.author },
      });
    }
  }

  if (r.vendor) {
    const v = r.vendor;
    const key = (v.website && domainKey(v.website)) || normalizeText(v.name);
    if (key) {
      rows.push({
        kind: "vendor",
        key,
        ref: null,
        title: [v.name, v.website].filter(Boolean).join(" · ") || key,
        verdict: v.rating,
        score: v.score,
        summary: [v.reputation_summary, v.offer_assessment].filter(Boolean).join(" "),
        details: { website: v.website, red_flags: v.red_flags, green_flags: v.green_flags },
      });
    }
  }

  const prints = rec.input.fingerprints ?? [];
  for (const m of r.media?.items ?? []) {
    const ref = baseRef(m.ref);
    const print = ref ? prints.find((p) => p.ref === ref && (p.kind === "image" || p.kind === "video")) : undefined;
    const key = print?.value ?? normalizeText(m.label);
    if (!key) continue;
    rows.push({
      kind: "media",
      key,
      ref,
      title: m.label,
      verdict: m.rating,
      score: m.authenticity_score,
      summary: m.provenance || m.findings.slice(0, 3).map((f) => f.observation).join("; "),
      details: { ai_generated_likelihood: m.ai_generated_likelihood, manipulation_likelihood: m.manipulation_likelihood },
    });
  }
  return rows;
}

/** One entity across every report that mentions it. */
export interface FindingGroup {
  kind: FindingKind;
  key: string;
  title: string;
  verdict: string;
  score: number | null;
  summary: string;
  details: Record<string, unknown>;
  reportId: string;
  checkedAt: string;
  count: number;
  verdicts: Record<string, number>;
  disputed: boolean;
}

const KIND_LABEL: Record<FindingKind, string> = { claim: "CLAIM", vendor: "SELLER", source: "ACCOUNT/OUTLET", media: "MEDIA" };

function age(iso: string, now: Date): string {
  const hours = (now.getTime() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Plain-text rendering for the model, with dates and agreement up front. */
export function formatGroups(groups: FindingGroup[], now = new Date()): string {
  return groups
    .map((g, i) => {
      const head = `${i + 1}. ${KIND_LABEL[g.kind]}: ${clip(g.title, 300)} → ${g.verdict}${g.score !== null ? ` (${g.score}/100)` : ""}. Last checked ${g.checkedAt.slice(0, 10)} (${age(g.checkedAt, now)}).`;
      const tally = Object.entries(g.verdicts)
        .map(([v, n]) => `${v} ×${n}`)
        .join(", ");
      const lines = [head];
      if (g.count > 1) lines.push(`   Seen in ${g.count} checks: ${tally}.`);
      if (g.disputed) lines.push("   A user flagged one of these results as possibly wrong; re-verify before relying on it.");
      if (g.summary) lines.push(`   ${clip(g.summary, 500)}`);
      const urls = Array.isArray(g.details.source_urls) ? (g.details.source_urls as string[]) : [];
      if (urls.length) lines.push(`   Sources: ${urls.slice(0, 5).join(", ")}`);
      const flags = Array.isArray(g.details.red_flags) ? (g.details.red_flags as string[]) : [];
      if (flags.length) lines.push(`   Red flags: ${flags.slice(0, 5).join("; ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** URLs cited by a set of groups (so grounding doesn't flag them as invented). */
export function groupUrls(groups: FindingGroup[]): string[] {
  return groups.flatMap((g) => (Array.isArray(g.details.source_urls) ? (g.details.source_urls as string[]) : []));
}

/** How long a report may be reused for an instant match. News moves fastest. */
export function freshnessHours(rec: AnalysisRecord): number {
  if (rec.report.news) return 24;
  if (rec.report.vendor) return 24 * 14;
  if (rec.report.media) return 24 * 30;
  return 24;
}
