import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DomainInfo } from "../analysis/domain.js";
import type { FocusArea } from "../analysis/schema.js";
import type { AnalysisRecord, ReportStore } from "../server/store.js";
import {
  hamming,
  SHORTLIST_BITS,
  thumbDistance,
  VERIFY_MAX_DIFF,
  VIDEO_MATCH_SHARE,
  videoOverlap,
  type Fingerprint,
} from "./fingerprint.js";
import {
  domainKey,
  extractFindings,
  FINDING_KINDS,
  formatGroups,
  freshnessHours,
  groupUrls,
  type FindingGroup,
  type FindingKind,
} from "./findings.js";

/**
 * troonooz's shared memory, in one SQLite file (`<dataDir>/knowledge.sqlite`).
 * It is an index derived from the JSON reports, so it can be deleted and is
 * rebuilt from them at startup.
 *
 * - `reports` + `prints`: fingerprints of what each report checked, for instant matches.
 * - `findings` + `findings_fts`: entities (claims, sellers, accounts, media) with
 *   full-text search, for the lookup_prior_findings tool and automatic context.
 * - `domains`: cached RDAP lookups.
 */

export interface KnownMatch {
  id: string;
  createdAt: string;
  matchedOn: Array<Fingerprint["kind"]>;
}

export interface MatchRequest {
  focus: FocusArea[];
  webResearch: boolean;
  demo: boolean;
  now?: Date;
}

interface PrintRow {
  report_id: string;
  ref: string | null;
  kind: string;
  value: string;
  thumb: string | null;
}

interface FindingDbRow {
  id: number;
  report_id: string;
  created_at: string;
  kind: FindingKind;
  key: string;
  title: string;
  verdict: string;
  score: number | null;
  summary: string;
  details: string;
  disputed: number;
}

const DOMAIN_TTL_DAYS = 7;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  demo INTEGER NOT NULL,
  focus TEXT NOT NULL,
  web INTEGER NOT NULL,
  fresh_until TEXT NOT NULL,
  disputed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prints (
  report_id TEXT NOT NULL,
  ref TEXT,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  thumb TEXT
);
CREATE INDEX IF NOT EXISTS prints_kind_value ON prints(kind, value);
CREATE INDEX IF NOT EXISTS prints_report ON prints(report_id);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  demo INTEGER NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  ref TEXT,
  title TEXT NOT NULL,
  verdict TEXT NOT NULL,
  score INTEGER,
  summary TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_kind_key ON findings(kind, key);
CREATE INDEX IF NOT EXISTS findings_report ON findings(report_id);
CREATE VIRTUAL TABLE IF NOT EXISTS findings_fts USING fts5(title, summary, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS disputes (
  report_id TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS domains (
  domain TEXT PRIMARY KEY,
  info TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`;

/** Turn free text into a safe FTS5 query: quoted terms joined with OR. */
export function ftsQuery(text: string): string | null {
  const terms = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2))].slice(0, 16);
  return terms.length ? terms.map((t) => `"${t}"`).join(" OR ") : null;
}

export class KnowledgeBase {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "knowledge.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
    this.db.exec(SCHEMA);
    this.db.function("hamming", { deterministic: true }, (a, b) => {
      const d = hamming(String(a), String(b));
      return Number.isFinite(d) ? d : 9999;
    });
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  hasReport(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM reports WHERE id = ?").get(id) !== undefined;
  }

  /** Add (or replace) a finished report's fingerprints and findings. */
  indexReport(rec: AnalysisRecord): void {
    const created = new Date(rec.created_at);
    const freshUntil = new Date(created.getTime() + freshnessHours(rec) * 3_600_000).toISOString();
    const findings = extractFindings(rec);
    this.tx(() => {
      this.removeRows(rec.id);
      this.db
        .prepare("INSERT INTO reports (id, created_at, demo, focus, web, fresh_until, disputed) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(rec.id, rec.created_at, rec.demo ? 1 : 0, JSON.stringify(rec.input.focus), rec.input.web_research ? 1 : 0, freshUntil, rec.disputed ? 1 : 0);
      const insPrint = this.db.prepare("INSERT INTO prints (report_id, ref, kind, value, thumb) VALUES (?, ?, ?, ?, ?)");
      for (const p of rec.input.fingerprints ?? []) insPrint.run(rec.id, p.ref, p.kind, p.value, p.thumb ?? null);
      const insFinding = this.db.prepare(
        "INSERT INTO findings (report_id, created_at, demo, kind, key, ref, title, verdict, score, summary, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const insFts = this.db.prepare("INSERT INTO findings_fts (rowid, title, summary) VALUES (?, ?, ?)");
      for (const f of findings) {
        const res = insFinding.run(rec.id, rec.created_at, rec.demo ? 1 : 0, f.kind, f.key, f.ref, f.title, f.verdict, f.score, f.summary, JSON.stringify(f.details));
        insFts.run(Number(res.lastInsertRowid), f.title, f.summary);
      }
    });
  }

  private removeRows(id: string): void {
    this.db.prepare("DELETE FROM findings_fts WHERE rowid IN (SELECT id FROM findings WHERE report_id = ?)").run(id);
    this.db.prepare("DELETE FROM findings WHERE report_id = ?").run(id);
    this.db.prepare("DELETE FROM prints WHERE report_id = ?").run(id);
    this.db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  }

  removeReport(id: string): void {
    this.tx(() => this.removeRows(id));
  }

  /** Index every stored report the database doesn't know yet (first run, or after deleting the file). */
  async syncFrom(store: ReportStore): Promise<number> {
    let added = 0;
    for (const id of store.ids()) {
      if (this.hasReport(id)) continue;
      const rec = await store.get(id);
      if (!rec) continue;
      this.indexReport(rec);
      added++;
    }
    return added;
  }

  dispute(reportId: string, note: string): void {
    this.tx(() => {
      this.db.prepare("UPDATE reports SET disputed = 1 WHERE id = ?").run(reportId);
      this.db.prepare("INSERT INTO disputes (report_id, at, note) VALUES (?, ?, ?)").run(reportId, new Date().toISOString(), note.slice(0, 1000));
    });
  }

  /** Report IDs (with the matching evidence ref) that contain the same content as `p`. */
  private async reportsWith(p: Fingerprint, demo: boolean): Promise<PrintRow[]> {
    const demoFlag = demo ? 1 : 0;
    if (p.kind === "url" || p.kind === "text") {
      return this.db
        .prepare(
          "SELECT p.report_id, p.ref, p.kind, p.value, NULL AS thumb FROM prints p JOIN reports r ON r.id = p.report_id WHERE p.kind = ? AND p.value = ? AND r.demo = ?",
        )
        .all(p.kind, p.value, demoFlag) as unknown as PrintRow[];
    }
    if (p.kind === "video") {
      const rows = this.db
        .prepare("SELECT p.report_id, p.ref, p.kind, p.value, NULL AS thumb FROM prints p JOIN reports r ON r.id = p.report_id WHERE p.kind = 'video' AND r.demo = ?")
        .all(demoFlag) as unknown as PrintRow[];
      return rows.filter((r) => videoOverlap(p.value, r.value) >= VIDEO_MATCH_SHARE);
    }
    if (!p.thumb) return [];
    const rows = this.db
      .prepare(
        "SELECT p.report_id, p.ref, p.kind, p.value, p.thumb FROM prints p JOIN reports r ON r.id = p.report_id WHERE p.kind = 'image' AND r.demo = ? AND hamming(p.value, ?) <= ?",
      )
      .all(demoFlag, p.value, SHORTLIST_BITS) as unknown as PrintRow[];
    const mine = Buffer.from(p.thumb, "base64");
    const out: PrintRow[] = [];
    for (const r of rows) {
      if (r.thumb && (await thumbDistance(mine, Buffer.from(r.thumb, "base64"))) <= VERIFY_MAX_DIFF) out.push(r);
    }
    return out;
  }

  /**
   * An earlier report covering exactly this content: every fingerprint of the
   * new submission must match, and the earlier check must be fresh, undisputed,
   * at least as thorough (web research), and cover the requested focus.
   */
  async findMatch(prints: Fingerprint[], req: MatchRequest): Promise<KnownMatch | null> {
    if (prints.length === 0) return null;
    const perPrint: Array<Set<string>> = [];
    for (const p of prints) {
      const found = new Set((await this.reportsWith(p, req.demo)).map((r) => r.report_id));
      if (found.size === 0) return null;
      perPrint.push(found);
    }
    const ids = [...perPrint[0]!].filter((id) => perPrint.every((s) => s.has(id)));
    if (ids.length === 0) return null;
    const now = (req.now ?? new Date()).toISOString();
    const rows = this.db
      .prepare(
        `SELECT id, created_at, focus, web FROM reports WHERE id IN (${ids.map(() => "?").join(",")}) AND disputed = 0 AND fresh_until > ? ORDER BY created_at DESC`,
      )
      .all(...ids, now) as Array<{ id: string; created_at: string; focus: string; web: number }>;
    for (const row of rows) {
      if (req.webResearch && !row.web) continue;
      const prior = JSON.parse(row.focus) as FocusArea[];
      const covered = prior.length === 0 || (req.focus.length > 0 && req.focus.every((f) => prior.includes(f)));
      if (!covered) continue;
      return { id: row.id, createdAt: row.created_at, matchedOn: [...new Set(prints.map((p) => p.kind))] };
    }
    return null;
  }

  private groupsFor(pairs: Array<{ kind: FindingKind; key: string }>, demo: boolean): FindingGroup[] {
    const stmt = this.db.prepare(
      `SELECT f.*, r.disputed FROM findings f JOIN reports r ON r.id = f.report_id
       WHERE f.kind = ? AND f.key = ? AND f.demo = ? ORDER BY f.created_at DESC LIMIT 25`,
    );
    const seen = new Set<string>();
    const groups: FindingGroup[] = [];
    for (const { kind, key } of pairs) {
      const id = `${kind}\u0000${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const rows = stmt.all(kind, key, demo ? 1 : 0) as unknown as FindingDbRow[];
      const latest = rows[0];
      if (!latest) continue;
      const verdicts: Record<string, number> = {};
      for (const r of rows) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
      groups.push({
        kind,
        key,
        title: latest.title,
        verdict: latest.verdict,
        score: latest.score,
        summary: latest.summary,
        details: JSON.parse(latest.details) as Record<string, unknown>,
        reportId: latest.report_id,
        checkedAt: latest.created_at,
        count: rows.length,
        verdicts,
        disputed: rows.some((r) => r.disputed === 1),
      });
    }
    return groups;
  }

  /** Full-text search over findings, for the lookup_prior_findings tool. */
  search(query: string, kind: FindingKind | "any", opts: { demo: boolean; limit?: number }): FindingGroup[] {
    const limit = opts.limit ?? 8;
    const pairs: Array<{ kind: FindingKind; key: string }> = [];
    const domain = /\.[a-z]{2,}/i.test(query) ? domainKey(query) : null;
    if (domain && (kind === "any" || kind === "vendor")) pairs.push({ kind: "vendor", key: domain });
    const match = ftsQuery(query);
    if (match) {
      const kindClause = kind === "any" ? "" : "AND f.kind = ?";
      const rows = this.db
        .prepare(
          `SELECT f.kind, f.key FROM findings_fts JOIN findings f ON f.id = findings_fts.rowid
           WHERE findings_fts MATCH ? AND f.demo = ? ${kindClause}
           ORDER BY bm25(findings_fts) LIMIT 60`,
        )
        .all(...([match, opts.demo ? 1 : 0, ...(kind === "any" ? [] : [kind])] as Array<string | number>)) as Array<{ kind: FindingKind; key: string }>;
      pairs.push(...rows);
    }
    return this.groupsFor(pairs, opts.demo).slice(0, limit);
  }

  /** Findings tied to this submission: earlier reports with any of the same content, plus sellers at the same domains. */
  async related(prints: Fingerprint[], domains: string[], opts: { demo: boolean; limit?: number }): Promise<FindingGroup[]> {
    const reportIds = new Set<string>();
    for (const p of prints) for (const r of await this.reportsWith(p, opts.demo)) reportIds.add(r.report_id);
    const pairs: Array<{ kind: FindingKind; key: string }> = domains.map((d) => ({ kind: "vendor" as const, key: d }));
    if (reportIds.size) {
      const ids = [...reportIds];
      const rows = this.db
        .prepare(`SELECT kind, key FROM findings WHERE report_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`)
        .all(...ids) as Array<{ kind: FindingKind; key: string }>;
      pairs.push(...rows);
    }
    return this.groupsFor(pairs, opts.demo)
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
      .slice(0, opts.limit ?? 10);
  }

  cachedDomain(domain: string, now = new Date()): DomainInfo | null {
    const row = this.db.prepare("SELECT info, fetched_at FROM domains WHERE domain = ?").get(domain) as
      | { info: string; fetched_at: string }
      | undefined;
    if (!row) return null;
    if (now.getTime() - new Date(row.fetched_at).getTime() > DOMAIN_TTL_DAYS * 86_400_000) return null;
    const info = JSON.parse(row.info) as DomainInfo;
    // Age moves on while cached.
    if (info.registered) info.ageDays = Math.floor((now.getTime() - new Date(info.registered).getTime()) / 86_400_000);
    return info;
  }

  saveDomain(info: DomainInfo, now = new Date()): void {
    if (info.error) return;
    this.db
      .prepare("INSERT INTO domains (domain, info, fetched_at) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET info = excluded.info, fetched_at = excluded.fetched_at")
      .run(info.domain, JSON.stringify(info), now.toISOString());
  }

  stats(): { reports: number; findings: number } {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
    const f = this.db.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number };
    return { reports: r.n, findings: f.n };
  }
}

export { FINDING_KINDS, formatGroups, groupUrls };
