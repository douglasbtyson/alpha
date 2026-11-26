/** The parts of a troonooz server's API this app reads. Mirrors src/analysis/schema.ts on the server. */

export type OverallRating =
  | "trustworthy"
  | "mostly_trustworthy"
  | "mixed"
  | "questionable"
  | "untrustworthy"
  | "unverifiable"
  | "nothing_to_check";

export interface Claim {
  claim: string;
  rating: string;
  explanation: string;
  source_urls: string[];
}

export interface News {
  rating: string;
  score: number;
  claims: Claim[];
  source_assessment: string;
  context: string;
  manipulation_tactics: string[];
}

export interface Vendor {
  name: string;
  website: string;
  rating: string;
  score: number;
  reputation_summary: string;
  offer_assessment: string;
  green_flags: string[];
  red_flags: string[];
}

export interface Product {
  name: string;
  rating: string;
  score: number;
  summary: string;
  pros: string[];
  cons: string[];
}

export interface MediaFinding {
  observation: string;
  signal: "authentic" | "suspicious" | "neutral";
}

export interface MediaItem {
  ref: string;
  label: string;
  rating: string;
  authenticity_score: number;
  ai_generated_likelihood: string;
  manipulation_likelihood: string;
  findings: MediaFinding[];
  provenance: string;
}

export interface RedFlag {
  severity: "low" | "medium" | "high" | "critical";
  category: "news" | "vendor" | "media" | "general";
  description: string;
}

export interface Source {
  title: string;
  url: string;
  supports: string;
  /** False when the URL never appeared in this check's research. */
  seen?: boolean;
}

export interface Report {
  verdict: {
    rating: OverallRating;
    trust_score: number;
    confidence: "low" | "medium" | "high";
    headline: string;
    score_reason?: string;
    would_raise?: string;
  };
  summary: string;
  background?: { simple: string; sections: { title: string; body: string }[] };
  content: { type: string; platform: string; author: string; published: string; description: string };
  news: News | null;
  vendor: Vendor | null;
  product?: Product | null;
  media: { items: MediaItem[] } | null;
  red_flags: RedFlag[];
  green_flags?: string[];
  recommendations: string[];
  sources: Source[];
  limitations: string[];
}

export interface Thumbnail {
  id: string;
  label: string;
  kind: string;
  dataUrl: string | null;
  url: string | null;
}

export interface StoryMember {
  id: string;
  created_at: string;
  headline: string;
  rating: string;
  trust_score: number;
}

export interface AnalysisRecord {
  id: string;
  created_at: string;
  duration_ms: number;
  demo: boolean;
  model: string;
  input: { source: string; mode?: "quick" | "thorough"; thumbnails: Thumbnail[] };
  report: Report;
  disputed?: { at: string; note: string } | null;
  story?: { id: string; title: string; checks: number; members: StoryMember[] } | null;
}

export interface RecordSummary {
  id: string;
  created_at: string;
  demo: boolean;
  headline: string;
  rating: OverallRating;
  trust_score: number;
  content_type: string;
  platform: string;
  thumbnail: string | null;
  disputed: boolean;
}

export interface ReportDraft {
  rating: string | null;
  trust_score: number | null;
  confidence: string | null;
  headline: string;
  summary: string;
  explanation: string;
}

export type ProgressEvent =
  | { type: "status"; message: string }
  | { type: "thinking" }
  | { type: "search"; query: string }
  | { type: "fetch"; url: string }
  | { type: "results"; count: number }
  | { type: "zoom"; image: string; reason: string }
  | { type: "lookup"; query: string }
  | { type: "writing" }
  | { type: "fallback"; from: string; to: string }
  | { type: "draft"; draft: ReportDraft };

export interface MatchInfo {
  id: string;
  created_at: string;
  matched_on: string[];
  headline: string;
  rating: string;
  trust_score: number;
  thumbnail: string | null;
  story?: { id: string; title: string; checks: number; reason: string };
}

export type JobEvent =
  | { type: "progress"; at: string; event: ProgressEvent }
  | { type: "done"; at: string; id: string }
  | { type: "match"; at: string; match: MatchInfo }
  | { type: "error"; at: string; code: string; message: string };

export interface JobState {
  id: string;
  status: "running" | "done" | "matched" | "error";
  events: JobEvent[];
  /** The verdict so far while the report is being written (servers before the app was added omit it). */
  draft?: ReportDraft | null;
}

export interface JobLinks {
  id: string;
  open_url: string;
  app_url?: string;
}

export interface Health {
  ok: boolean;
  app: string;
  base_url?: string;
  demo: boolean;
  model: string;
  quick_model?: string;
  claude_configured: boolean;
  auth_required: boolean;
}
