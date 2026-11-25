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
import type { StorySignature } from "./triage.js";
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

/** A story: every report about the same claim, event, piece of media, or offer. */
export interface StoryCard {
  id: string;
  title: string;
  summary: string;
  headline: string;
  verdict: string;
  trustScore: number;
  checks: number;
  firstSeen: string;
  lastChecked: string;
  /** The report that represents the story: the newest one nobody disputed (else the newest). */
  latestReport: string;
  thumbnail: string | null;
  /** The representative report is fresh and undisputed, so it may be shown as an instant result. */
  reusable: boolean;
  disputed: boolean;
  focus: FocusArea[];
  webResearch: boolean;
}

export interface StoryMember {
  id: string;
  created_at: string;
  headline: string;
  rating: string;
  trust_score: number;
  disputed: boolean;
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

interface ReportRow {
  id: string;
  created_at: string;
  demo: number;
  focus: string;
  web: number;
  fresh_until: string;
  disputed: number;
  headline: string;
  description: string;
  rating: string;
  trust_score: number;
  thumbnail: string | null;
  signature: string | null;
  linked_to: string | null;
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
/** Bump when the schema changes: the database is a derived index, so it is simply rebuilt. */
const SCHEMA_VERSION = 2;
const TABLES = ["reports", "prints", "findings", "findings_fts", "disputes", "domains", "stories", "story_reports", "stories_fts"];
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  demo INTEGER NOT NULL,
  focus TEXT NOT NULL,
  web INTEGER NOT NULL,
  fresh_until TEXT NOT NULL,
  disputed INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL,
  description TEXT NOT NULL,
  rating TEXT NOT NULL,
  trust_score INTEGER NOT NULL,
  thumbnail TEXT,
  signature TEXT,
  linked_to TEXT
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
CREATE TABLE IF NOT EXISTS stories (
  sid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  demo INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  latest_report TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT '',
  last_checked TEXT NOT NULL DEFAULT '',
  checks INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS story_reports (
  report_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS story_reports_story ON story_reports(story_id);
CREATE VIRTUAL TABLE IF NOT EXISTS stories_fts USING fts5(title, summary, keywords, tokenize = 'porter unicode61');
`;

/** Whether an earlier check's focus covers what is being asked for now. */
export function focusCovers(prior: FocusArea[], requested: FocusArea[]): boolean {
  return prior.length === 0 || (requested.length > 0 && requested.every((f) => prior.includes(f)));
}

/** Plain-text story cards for Claude. */
export function formatStories(cards: StoryCard[], now = new Date()): string {
  return cards
    .map((c, i) => {
      const days = Math.round((now.getTime() - new Date(c.lastChecked).getTime()) / 86_400_000);
      const when = days < 1 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
      const lines = [
        `${i + 1}. STORY: ${c.title} \u2192 ${c.verdict} (${c.trustScore}/100). Checked ${c.checks} time${c.checks === 1 ? "" : "s"}, most recently ${c.lastChecked.slice(0, 10)} (${when}).`,
      ];
      if (c.disputed) lines.push("   A user flagged the latest result as possibly wrong; re-verify.");
      if (c.summary) lines.push(`   What it was: ${c.summary.slice(0, 400)}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** Turn free text into a safe FTS5 query: quoted terms joined with OR. */
export function ftsQuery(text: string, maxTerms = 16): string | null {
  const terms = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2))].slice(0, maxTerms);
  return terms.length ? terms.map((t) => `"${t}"`).join(" OR ") : null;
}

export class KnowledgeBase {
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "knowledge.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;");
    const { user_version: version } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version !== SCHEMA_VERSION) {
      // Older layout: drop everything; syncFrom() rebuilds it from the JSON reports.
      for (const t of TABLES) this.db.exec(`DROP TABLE IF EXISTS ${t}`);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
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
        .prepare(
          `INSERT INTO reports (id, created_at, demo, focus, web, fresh_until, disputed, headline, description, rating, trust_score, thumbnail, signature, linked_to)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          rec.id,
          rec.created_at,
          rec.demo ? 1 : 0,
          JSON.stringify(rec.input.focus),
          rec.input.web_research ? 1 : 0,
          freshUntil,
          rec.disputed ? 1 : 0,
          rec.report.verdict.headline,
          rec.report.content.description,
          rec.report.verdict.rating,
          rec.report.verdict.trust_score,
          rec.input.thumbnails.find((t) => t.dataUrl)?.dataUrl ?? null,
          rec.input.story_signature ? JSON.stringify(rec.input.story_signature) : null,
          rec.linked_to ?? null,
        );
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
    const story = this.storyIdOf(id);
    this.tx(() => {
      this.removeRows(id);
      this.db.prepare("DELETE FROM story_reports WHERE report_id = ?").run(id);
      if (story) this.refreshStory(story);
    });
  }

  /**
   * Index every stored report the database doesn't know yet (first run, after an
   * upgrade, or after deleting the file), then group unassigned reports into
   * stories in the order they were made.
   */
  async syncFrom(store: ReportStore): Promise<number> {
    let added = 0;
    const records: AnalysisRecord[] = [];
    for (const id of store.ids()) {
      const known = this.hasReport(id);
      if (known && this.storyIdOf(id)) continue;
      const rec = await store.get(id);
      if (!rec) continue;
      if (!known) {
        this.indexReport(rec);
        added++;
      }
      records.push(rec);
    }
    records.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const rec of records) await this.linkStory(rec);
    return added;
  }

  dispute(reportId: string, note: string): void {
    const story = this.storyIdOf(reportId);
    this.tx(() => {
      this.db.prepare("UPDATE reports SET disputed = 1 WHERE id = ?").run(reportId);
      this.db.prepare("INSERT INTO disputes (report_id, at, note) VALUES (?, ?, ?)").run(reportId, new Date().toISOString(), note.slice(0, 1000));
      if (story) this.refreshStory(story);
    });
  }

  // ---------------------------------------------------------------- stories

  storyIdOf(reportId: string): string | null {
    const row = this.db.prepare("SELECT story_id FROM story_reports WHERE report_id = ?").get(reportId) as { story_id: string } | undefined;
    return row?.story_id ?? null;
  }

  storyCount(demo: boolean): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM stories WHERE demo = ? AND checks > 0").get(demo ? 1 : 0) as { n: number };
    return row.n;
  }

  /**
   * Put a newly indexed report into a story: the one it was explicitly linked to
   * (a re-check of a story match, or a triage match), else a story whose reports
   * share its link, text, image, seller, or an identical claim, else a new story.
   */
  async linkStory(rec: AnalysisRecord): Promise<string> {
    const existing = this.storyIdOf(rec.id);
    if (existing) {
      this.refreshStory(existing);
      return existing;
    }
    let storyId = rec.linked_to ? this.storyIdOf(rec.linked_to) : null;
    if (!storyId) {
      const related = new Set<string>();
      for (const p of rec.input.fingerprints ?? []) {
        for (const r of await this.reportsWith(p, rec.demo)) if (r.report_id !== rec.id) related.add(r.report_id);
      }
      const keys = extractFindings(rec).filter((f) => f.kind === "vendor" || f.kind === "claim");
      const byKey = this.db.prepare("SELECT report_id FROM findings WHERE kind = ? AND key = ? AND report_id != ? AND demo = ?");
      for (const f of keys) {
        for (const r of byKey.all(f.kind, f.key, rec.id, rec.demo ? 1 : 0) as Array<{ report_id: string }>) related.add(r.report_id);
      }
      const stories = [...related].map((id) => this.storyIdOf(id)).filter((id): id is string => id !== null);
      if (stories.length) {
        const row = this.db
          .prepare(`SELECT id FROM stories WHERE id IN (${stories.map(() => "?").join(",")}) ORDER BY last_checked DESC LIMIT 1`)
          .get(...stories) as { id: string } | undefined;
        storyId = row?.id ?? null;
      }
    }
    this.tx(() => {
      if (!storyId) {
        storyId = `st_${rec.id}`;
        this.db.prepare("INSERT OR IGNORE INTO stories (id, demo) VALUES (?, ?)").run(storyId, rec.demo ? 1 : 0);
      }
      this.db.prepare("INSERT OR REPLACE INTO story_reports (report_id, story_id) VALUES (?, ?)").run(rec.id, storyId);
      this.refreshStory(storyId);
    });
    return storyId!;
  }

  private members(storyId: string): ReportRow[] {
    return this.db
      .prepare("SELECT r.* FROM reports r JOIN story_reports s ON s.report_id = r.id WHERE s.story_id = ? ORDER BY r.created_at DESC")
      .all(storyId) as unknown as ReportRow[];
  }

  /** Recompute a story's title, summary, search keywords, and representative report from its members. */
  private refreshStory(storyId: string): void {
    const story = this.db.prepare("SELECT sid FROM stories WHERE id = ?").get(storyId) as { sid: number } | undefined;
    if (!story) return;
    const members = this.members(storyId);
    this.db.prepare("DELETE FROM stories_fts WHERE rowid = ?").run(story.sid);
    if (members.length === 0) {
      this.db.prepare("DELETE FROM stories WHERE id = ?").run(storyId);
      return;
    }
    const rep = members.find((m) => !m.disputed) ?? members[0]!;
    const words: string[] = [];
    for (const m of members) {
      words.push(m.headline, m.description);
      if (m.signature) {
        const sig = JSON.parse(m.signature) as StorySignature;
        words.push(sig.description, ...sig.claims, ...sig.entities, sig.search_terms);
      }
    }
    const ids = members.map((m) => m.id);
    const titles = this.db
      .prepare(`SELECT title FROM findings WHERE report_id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as Array<{ title: string }>;
    words.push(...titles.map((t) => t.title));
    const keywords = [...new Set(words.filter(Boolean))].join(" \u00b7 ").slice(0, 8000);
    const created = members.map((m) => m.created_at).sort();
    this.db
      .prepare("UPDATE stories SET title = ?, summary = ?, keywords = ?, latest_report = ?, first_seen = ?, last_checked = ?, checks = ? WHERE id = ?")
      .run(rep.headline, rep.description, keywords, rep.id, created[0]!, created.at(-1)!, members.length, storyId);
    this.db.prepare("INSERT INTO stories_fts (rowid, title, summary, keywords) VALUES (?, ?, ?, ?)").run(story.sid, rep.headline, rep.description, keywords);
  }

  storyCard(storyId: string, now = new Date()): StoryCard | null {
    const s = this.db.prepare("SELECT * FROM stories WHERE id = ?").get(storyId) as
      | { id: string; title: string; summary: string; latest_report: string; first_seen: string; last_checked: string; checks: number }
      | undefined;
    if (!s || !s.checks) return null;
    const rep = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(s.latest_report) as unknown as ReportRow | undefined;
    if (!rep) return null;
    return {
      id: s.id,
      title: s.title,
      summary: s.summary,
      headline: rep.headline,
      verdict: rep.rating,
      trustScore: rep.trust_score,
      checks: s.checks,
      firstSeen: s.first_seen,
      lastChecked: s.last_checked,
      latestReport: rep.id,
      thumbnail: rep.thumbnail,
      reusable: !rep.disputed && rep.fresh_until > now.toISOString(),
      disputed: rep.disputed === 1,
      focus: JSON.parse(rep.focus) as FocusArea[],
      webResearch: rep.web === 1,
    };
  }

  /** The story a report belongs to, with every check in it (newest first). */
  storyOf(reportId: string): { card: StoryCard; members: StoryMember[] } | null {
    const id = this.storyIdOf(reportId);
    const card = id ? this.storyCard(id) : null;
    if (!id || !card) return null;
    const members = this.members(id).map((m) => ({
      id: m.id,
      created_at: m.created_at,
      headline: m.headline,
      rating: m.rating,
      trust_score: m.trust_score,
      disputed: m.disputed === 1,
    }));
    return { card, members };
  }

  /** Stories whose text best matches a description of new content. */
  findStories(text: string, opts: { demo: boolean; limit?: number; now?: Date }): StoryCard[] {
    const match = ftsQuery(text, 40);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT s.id FROM stories_fts JOIN stories s ON s.sid = stories_fts.rowid
         WHERE stories_fts MATCH ? AND s.demo = ? AND s.checks > 0 ORDER BY bm25(stories_fts) LIMIT ?`,
      )
      .all(match, opts.demo ? 1 : 0, opts.limit ?? 5) as Array<{ id: string }>;
    return rows.map((r) => this.storyCard(r.id, opts.now)).filter((c): c is StoryCard => c !== null);
  }

  /** Stories that contain any of these reports. */
  storiesOfReports(reportIds: string[]): StoryCard[] {
    const ids = [...new Set(reportIds.map((r) => this.storyIdOf(r)).filter((s): s is string => s !== null))];
    return ids.map((id) => this.storyCard(id)).filter((c): c is StoryCard => c !== null);
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
      if (!focusCovers(JSON.parse(row.focus) as FocusArea[], req.focus)) continue;
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

  /** Earlier reports that contain any of the same content. */
  async reportsSharing(prints: Fingerprint[], demo: boolean): Promise<string[]> {
    const ids = new Set<string>();
    for (const p of prints) for (const r of await this.reportsWith(p, demo)) ids.add(r.report_id);
    return [...ids];
  }

  /** Findings tied to this submission: earlier reports with any of the same content, plus sellers at the same domains. */
  async related(prints: Fingerprint[], domains: string[], opts: { demo: boolean; limit?: number }): Promise<FindingGroup[]> {
    const reportIds = new Set<string>(await this.reportsSharing(prints, opts.demo));
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

  stats(): { reports: number; findings: number; stories: number } {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
    const f = this.db.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number };
    const st = this.db.prepare("SELECT COUNT(*) AS n FROM stories WHERE checks > 0").get() as { n: number };
    return { reports: r.n, findings: f.n, stories: st.n };
  }
}

export { FINDING_KINDS, formatGroups, groupUrls };
