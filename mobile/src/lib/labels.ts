/** Human labels and tones for the server's rating values (kept in step with public/js/render.js). */

export type Tone = "good" | "ok" | "caution" | "warn" | "bad" | "neutral";
type LabelMap = Record<string, [string, Tone]>;

export const OVERALL: LabelMap = {
  trustworthy: ["Trustworthy", "good"],
  mostly_trustworthy: ["Mostly trustworthy", "ok"],
  mixed: ["Mixed", "caution"],
  questionable: ["Questionable", "warn"],
  untrustworthy: ["Untrustworthy", "bad"],
  unverifiable: ["Unverifiable", "neutral"],
  nothing_to_check: ["Nothing to verify", "neutral"],
};

export const NEWS: LabelMap = {
  verified: ["Verified", "good"],
  likely_true: ["Likely true", "ok"],
  mixed: ["Mixed", "caution"],
  unverified: ["Unverified", "neutral"],
  misleading: ["Misleading", "warn"],
  likely_false: ["Likely false", "bad"],
  false: ["False", "bad"],
  satire: ["Satire", "neutral"],
  opinion: ["Opinion", "neutral"],
};

export const CLAIM: LabelMap = {
  supported: ["Supported", "good"],
  partly_supported: ["Partly supported", "caution"],
  unsupported: ["Unsupported", "warn"],
  contradicted: ["Contradicted", "bad"],
  unverifiable: ["Unverifiable", "neutral"],
  opinion: ["Opinion", "neutral"],
};

export const VENDOR: LabelMap = {
  reputable: ["Reputable", "good"],
  established: ["Established", "ok"],
  mixed: ["Mixed reputation", "caution"],
  caution: ["Use caution", "warn"],
  high_risk: ["High risk", "bad"],
  likely_scam: ["Likely scam", "bad"],
  unknown: ["Unknown", "neutral"],
};

export const PRODUCT: LabelMap = {
  excellent: ["Excellent", "good"],
  good: ["Good", "ok"],
  mixed: ["Mixed", "caution"],
  poor: ["Poor", "bad"],
  unknown: ["Not enough info", "neutral"],
};

export const MEDIA: LabelMap = {
  likely_authentic: ["Likely authentic", "good"],
  edited: ["Edited", "caution"],
  manipulated: ["Manipulated", "bad"],
  ai_generated: ["AI-generated", "bad"],
  out_of_context: ["Out of context", "warn"],
  fabricated_screenshot: ["Fabricated screenshot", "bad"],
  inconclusive: ["Inconclusive", "neutral"],
};

export const SEVERITY: LabelMap = {
  critical: ["Critical", "bad"],
  high: ["High", "warn"],
  medium: ["Medium", "caution"],
  low: ["Low", "neutral"],
};

export const CONTENT_TYPES: Record<string, string> = {
  social_post: "Social media post",
  news_article: "News article",
  advertisement: "Advertisement",
  marketplace_listing: "Marketplace listing",
  online_store: "Online store",
  web_page: "Web page",
  image: "Image",
  video: "Video",
  message: "Message",
  other: "Other",
};

export const LIKELIHOOD: Record<string, string> = {
  very_low: "Very low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

export function label(map: LabelMap, key: string): [string, Tone] {
  return map[key] ?? [key.replace(/_/g, " "), "neutral"];
}

/** Same bands as the trust score rubric: 85+ good, 70+ ok, 50+ caution, 30+ warn, else bad. */
export function scoreTone(score: number, rating?: string): Tone {
  if (rating === "unverifiable" || rating === "nothing_to_check") return "neutral";
  if (score >= 85) return "good";
  if (score >= 70) return "ok";
  if (score >= 50) return "caution";
  if (score >= 30) return "warn";
  return "bad";
}

/** "Nothing to verify" verdicts have no meaningful number. */
export function scoreText(score: number, rating?: string): string {
  return rating === "nothing_to_check" ? "–" : String(score);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString();
}
