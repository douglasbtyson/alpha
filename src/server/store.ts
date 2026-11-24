import { mkdir, readdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { DomainInfo } from "../analysis/domain.js";
import type { SignalEntry, Thumbnail } from "../analysis/evidence.js";
import type { AnalysisResult } from "../analysis/analyzer.js";
import type { FocusArea, FinalReport } from "../analysis/schema.js";
import type { InputSource } from "../analysis/input.js";
import type { Fingerprint } from "../knowledge/fingerprint.js";

/** Everything persisted about one finished analysis. */
export interface AnalysisRecord {
  id: string;
  created_at: string;
  completed_at: string;
  duration_ms: number;
  demo: boolean;
  model: string;
  input: {
    source: InputSource;
    focus: FocusArea[];
    web_research: boolean;
    text_excerpt: string;
    urls: string[];
    page: { url: string; title: string } | null;
    thumbnails: Thumbnail[];
    notes: string[];
    /** Content fingerprints for instant matching (absent on reports made before the feature). */
    fingerprints?: Fingerprint[];
  };
  signals: SignalEntry[];
  domains: DomainInfo[];
  report: FinalReport;
  research: AnalysisResult["research"];
  usage: AnalysisResult["usage"];
  turns: number;
  zooms: number;
  /** Set when a user flags the result as possibly wrong; disputed reports are never reused. */
  disputed?: { at: string; note: string } | null;
}

export interface RecordSummary {
  id: string;
  created_at: string;
  demo: boolean;
  headline: string;
  rating: FinalReport["verdict"]["rating"];
  trust_score: number;
  content_type: FinalReport["content"]["type"];
  platform: string;
  thumbnail: string | null;
  disputed: boolean;
}

export const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

function summarize(r: AnalysisRecord): RecordSummary {
  return {
    id: r.id,
    created_at: r.created_at,
    demo: r.demo,
    headline: r.report.verdict.headline,
    rating: r.report.verdict.rating,
    trust_score: r.report.verdict.trust_score,
    content_type: r.report.content.type,
    platform: r.report.content.platform,
    thumbnail: r.input.thumbnails.find((t) => t.dataUrl)?.dataUrl ?? null,
    disputed: Boolean(r.disputed),
  };
}

/** Reports as JSON files on disk, with an in-memory index for the history list. */
export class ReportStore {
  private readonly dir: string;
  private readonly index = new Map<string, RecordSummary>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "reports");
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(await readFile(join(this.dir, name), "utf8")) as AnalysisRecord;
        if (ID_RE.test(rec.id)) this.index.set(rec.id, summarize(rec));
      } catch {
        // Skip unreadable files rather than refusing to start.
      }
    }
  }

  async save(rec: AnalysisRecord): Promise<void> {
    if (!ID_RE.test(rec.id)) throw new Error("invalid id");
    const file = join(this.dir, `${rec.id}.json`);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(rec));
    await rename(tmp, file);
    this.index.set(rec.id, summarize(rec));
  }

  async get(id: string): Promise<AnalysisRecord | null> {
    if (!ID_RE.test(id) || !this.index.has(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), "utf8")) as AnalysisRecord;
    } catch {
      return null;
    }
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  async delete(id: string): Promise<boolean> {
    if (!ID_RE.test(id) || !this.index.has(id)) return false;
    await rm(join(this.dir, `${id}.json`), { force: true });
    this.index.delete(id);
    return true;
  }

  summary(id: string): RecordSummary | null {
    return this.index.get(id) ?? null;
  }

  ids(): string[] {
    return [...this.index.keys()];
  }

  /** Record a user's report that the result looks wrong. */
  async markDisputed(id: string, note: string): Promise<AnalysisRecord | null> {
    const rec = await this.get(id);
    if (!rec) return null;
    rec.disputed = { at: new Date().toISOString(), note: note.slice(0, 1000) };
    await this.save(rec);
    return rec;
  }

  list(limit = 50): RecordSummary[] {
    return [...this.index.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }
}
