import type Anthropic from "@anthropic-ai/sdk";
import type { FinalReport, Report } from "./schema.js";

type Block = Anthropic.Beta.BetaContentBlock;

const URL_RE = /https?:\/\/[^\s"'<>\\)\]]+/g;

/**
 * Canonical form for comparing URLs: ignore scheme, "www.", fragments,
 * trailing slashes, and tracking parameters.
 */
export function canonicalUrl(raw: string, keepQuery = true): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    let query = "";
    if (keepQuery) {
      const params = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid$|gclid$|ref$|ref_src$|s$|si$)/i.test(k));
      params.sort(([a], [b]) => a.localeCompare(b));
      query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    }
    return `${host}${path}${query}`;
  } catch {
    return null;
  }
}

/** Every URL the research actually surfaced: search results, fetched pages, citations, tool output. */
export class UrlLedger {
  private readonly exact = new Set<string>();
  private readonly loose = new Set<string>();
  readonly queries: string[] = [];
  readonly fetched: string[] = [];

  add(url: string): void {
    const a = canonicalUrl(url, true);
    const b = canonicalUrl(url, false);
    if (a) this.exact.add(a);
    if (b) this.loose.add(b);
  }

  has(url: string): boolean {
    const a = canonicalUrl(url, true);
    const b = canonicalUrl(url, false);
    return (a !== null && this.exact.has(a)) || (b !== null && this.loose.has(b));
  }

  get size(): number {
    return this.loose.size;
  }

  /** Record URLs from a response's server-tool results and text citations. */
  collect(content: Block[]): void {
    for (const block of content) {
      switch (block.type) {
        case "server_tool_use": {
          const input = block.input as Record<string, unknown>;
          if (block.name === "web_search" && typeof input.query === "string") this.queries.push(input.query);
          if (block.name === "web_fetch" && typeof input.url === "string") this.fetched.push(input.url);
          break;
        }
        case "text":
          for (const c of block.citations ?? []) {
            if ("url" in c && typeof c.url === "string") this.add(c.url);
          }
          break;
        case "tool_use":
        case "thinking":
        case "redacted_thinking":
          break; // the model's own words are not evidence of a source
        default:
          if (block.type.endsWith("_tool_result")) this.walk(block);
      }
    }
  }

  private walk(node: unknown, key = ""): void {
    if (typeof node === "string") {
      if (key === "url") this.add(node);
      else if (key === "stdout" || key === "text") for (const m of node.match(URL_RE) ?? []) this.add(m);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) this.walk(n, key);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "encrypted_content" || k === "encrypted_index") continue;
        this.walk(v, k);
      }
    }
  }
}

/**
 * Mark each cited source as seen or not. A source the model cites that never
 * appeared in its research (or in the user's submission) is kept but flagged,
 * so the UI can warn instead of silently trusting it.
 */
export function applyGrounding(report: Report, ledger: UrlLedger, userUrls: string[]): { report: FinalReport; unseen: string[] } {
  for (const u of userUrls) ledger.add(u);
  const unseen = new Set<string>();
  const sources = report.sources.map((s) => {
    const seen = ledger.has(s.url);
    if (!seen) unseen.add(s.url);
    return { ...s, seen };
  });
  if (report.news) {
    for (const c of report.news.claims) for (const u of c.source_urls) if (!ledger.has(u)) unseen.add(u);
  }
  return { report: { ...report, sources }, unseen: [...unseen] };
}
