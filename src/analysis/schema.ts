import * as z from "zod/v4";

/**
 * The structured report Claude submits through the `submit_report` tool.
 *
 * Kept deliberately flat and free of numeric/length constraints: strict tool
 * schemas don't support `minimum`/`maxLength`, so scores are clamped in
 * `normalizeReport` instead. Unknown string fields are "" rather than null to
 * keep the number of union-typed fields small.
 */

export const FOCUS_AREAS = ["news", "vendor", "media"] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];

export const CONTENT_TYPES = [
  "social_post",
  "news_article",
  "advertisement",
  "marketplace_listing",
  "online_store",
  "web_page",
  "image",
  "video",
  "message",
  "other",
] as const;

export const OVERALL_RATINGS = [
  "trustworthy",
  "mostly_trustworthy",
  "mixed",
  "questionable",
  "untrustworthy",
  "unverifiable",
  "nothing_to_check",
] as const;

/** Neutral score stored for "nothing_to_check" verdicts; the app shows no number for them. */
export const NOTHING_TO_CHECK_SCORE = 50;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const NEWS_RATINGS = [
  "verified",
  "likely_true",
  "mixed",
  "unverified",
  "misleading",
  "likely_false",
  "false",
  "satire",
  "opinion",
] as const;

export const CLAIM_RATINGS = [
  "supported",
  "partly_supported",
  "unsupported",
  "contradicted",
  "unverifiable",
  "opinion",
] as const;

export const VENDOR_RATINGS = [
  "reputable",
  "established",
  "mixed",
  "caution",
  "high_risk",
  "likely_scam",
  "unknown",
] as const;

export const MEDIA_RATINGS = [
  "likely_authentic",
  "edited",
  "manipulated",
  "ai_generated",
  "out_of_context",
  "fabricated_screenshot",
  "inconclusive",
] as const;

export const PRODUCT_RATINGS = ["excellent", "good", "mixed", "poor", "unknown"] as const;

export const LIKELIHOODS = ["very_low", "low", "moderate", "high", "very_high", "unknown"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const FLAG_CATEGORIES = ["news", "vendor", "media", "general"] as const;
export const SIGNALS = ["authentic", "suspicious", "neutral"] as const;

const score = (what: string) =>
  z.number().describe(`Integer 0-100. ${what}`);

const ClaimSchema = z.object({
  claim: z.string().describe("The checkable factual claim, quoted or closely paraphrased."),
  rating: z.enum(CLAIM_RATINGS),
  explanation: z.string().describe("What the evidence shows, in one short sentence (under 25 words)."),
  source_urls: z
    .array(z.string())
    .describe("URLs from your research that support this rating. Only URLs you actually saw."),
});

const NewsSchema = z.object({
  rating: z.enum(NEWS_RATINGS),
  score: score("How legitimate/accurate the news content is (100 = fully accurate and well sourced)."),
  claims: z.array(ClaimSchema).describe("The most important checkable claims, most consequential first (at most 4)."),
  source_assessment: z
    .string()
    .describe("Credibility of the outlet/account/author (real? track record? impersonation or parody?), in 1-2 short sentences."),
  context: z
    .string()
    .describe('Missing context, date problems (e.g. old story recirculated), or framing issues, in one sentence. "" if none.'),
  manipulation_tactics: z
    .array(z.string())
    .describe("Manipulation techniques present, as short phrases (e.g. outrage bait, false urgency, misleading headline)."),
});

const VendorSchema = z.object({
  name: z.string().describe('Seller, brand, store, or advertiser name. "" if unknown.'),
  website: z.string().describe('Vendor domain or URL if known. "" if unknown.'),
  rating: z.enum(VENDOR_RATINGS),
  score: score("How trustworthy the vendor and offer are (100 = well-established, reputable, safe to buy from)."),
  reputation_summary: z
    .string()
    .describe("What independent sources say (reviews, complaints, scam reports, regulators, business age), in 1-2 short sentences."),
  offer_assessment: z
    .string()
    .describe('Whether the price, claims, and terms are realistic, in one sentence. "" if not applicable.'),
  green_flags: z.array(z.string()),
  red_flags: z.array(z.string()),
});

const ProductSchema = z.object({
  name: z.string().describe('The product as advertised, e.g. "Striped knee-high tube socks". "" if unclear.'),
  rating: z.enum(PRODUCT_RATINGS),
  score: score(
    "Product quality and value for money, judged from independent reviews, ratings, materials or specs, and comparison with similar products (100 = excellent). Separate from whether the seller is trustworthy.",
  ),
  summary: z.string().describe("What independent sources say about the product's quality and value, in 1-2 short sentences."),
  pros: z.array(z.string()).describe("Short phrases, under 10 words each."),
  cons: z.array(z.string()).describe("Short phrases, under 10 words each."),
});

const FindingSchema = z.object({
  observation: z.string().describe("A specific, located observation (what and where), in under 20 words."),
  signal: z.enum(SIGNALS).describe("Whether this observation points toward authentic, suspicious, or neither."),
});

const MediaItemSchema = z.object({
  ref: z
    .string()
    .describe('Evidence ID(s) this item covers, e.g. "img1", "img2.1", "vid1", or "img1 (photo inside the post)".'),
  label: z.string().describe('Short human label, e.g. "Flood photo in the post" or "Video clip.mp4".'),
  rating: z.enum(MEDIA_RATINGS),
  authenticity_score: score("Likelihood the media is an authentic, unaltered, correctly-contextualized capture (100 = certainly authentic)."),
  ai_generated_likelihood: z.enum(LIKELIHOODS),
  manipulation_likelihood: z.enum(LIKELIHOODS),
  findings: z.array(FindingSchema),
  provenance: z
    .string()
    .describe('Earliest known source or original context you found, in one sentence. "" if none found.'),
});

const MediaSchema = z.object({
  items: z.array(MediaItemSchema),
});

const RedFlagSchema = z.object({
  severity: z.enum(SEVERITIES),
  category: z.enum(FLAG_CATEGORIES),
  description: z.string().describe("Short phrase, under 12 words."),
});

const BackgroundSectionSchema = z.object({
  title: z.string().describe('Short heading, e.g. "Who\'s involved", "How we got here", "Why it\'s circulating now", "What\'s disputed", "Key terms".'),
  body: z.string().describe("1-2 short sentences (under 40 words)."),
});

const BackgroundSchema = z.object({
  simple: z
    .string()
    .describe("1-2 everyday sentences (under 40 words): what this is about and the backstory a newcomer needs. Explains the topic; does not restate the verdict."),
  sections: z.array(BackgroundSectionSchema).describe("Deeper background for readers who tap to learn more (2-4 sections, most useful first; fewer if there is little backstory)."),
});

const SourceSchema = z.object({
  title: z.string(),
  url: z.string().describe("Exact URL as it appeared in your search or fetch results."),
  supports: z.string().describe("What this source shows, in one short sentence."),
});

export const ReportSchema = z.object({
  verdict: z.object({
    rating: z.enum(OVERALL_RATINGS),
    trust_score: score("Overall trustworthiness (see rubric in the instructions)."),
    confidence: z.enum(CONFIDENCE_LEVELS),
    headline: z
      .string()
      .describe('Short verdict, at most about 60 characters, e.g. "Accurate: Musk Foundation matched Austin\'s $500K" or "Recycled hoax: doctored shark photo".'),
    score_reason: z
      .string()
      .describe("One short sentence (under 25 words): what raised or lowered the score most. For nothing_to_check, why there is nothing to verify."),
    would_raise: z
      .string()
      .describe('What evidence would move the score higher, in one short sentence. "" if nothing could, or for nothing_to_check.'),
  }),
  summary: z.string().describe("Plain-language bottom line for a non-expert, in 1-2 short sentences (under 45 words)."),
  background: BackgroundSchema.describe("Plain-language background so the reader understands what they are looking at."),
  content: z.object({
    type: z.enum(CONTENT_TYPES),
    platform: z.string().describe('Platform or site, e.g. "Facebook", "X", "TikTok", "Amazon", "nytimes.com". "" if unknown.'),
    author: z.string().describe('Account, outlet, seller, or byline as shown. "" if unknown.'),
    published: z.string().describe('Publication date/time as shown or established. "" if unknown.'),
    description: z.string().describe("Neutral description of what the material shows and claims, in one sentence."),
  }),
  news: NewsSchema.nullable().describe("News/claims assessment, or null if the material makes no news or factual claims."),
  vendor: VendorSchema.nullable().describe("Vendor/seller assessment, or null if nothing is being sold or promoted."),
  product: ProductSchema.nullable().describe("Product quality assessment, or null if no specific product is advertised, sold, or reviewed."),
  media: MediaSchema.nullable().describe("Image/video authenticity assessment, or null if there is no photo or video content to assess."),
  red_flags: z
    .array(RedFlagSchema)
    .describe("The most important concerning signals across news, seller, product, and media, most severe first (at most 5)."),
  green_flags: z
    .array(z.string())
    .describe("The most important reassuring signals across news, seller, product, and media (at most 5). Short phrases, under 12 words each. [] if none."),
  recommendations: z.array(z.string()).describe("Concrete next steps for the reader (1-3), under 12 words each."),
  sources: z.array(SourceSchema).describe("The sources your verdict relies on."),
  limitations: z.array(z.string()).describe("What you could not check, briefly (1-3 short items)."),
});

export type Report = z.infer<typeof ReportSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type ReportSource = z.infer<typeof SourceSchema>;

/** A source after grounding: `seen` is true when the URL appeared in this analysis's research. */
export type GroundedSource = ReportSource & { seen: boolean };
export type FinalReport = Omit<Report, "sources"> & { sources: GroundedSource[] };

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));

/** Clamp scores and tidy strings. Grounding is applied separately (see grounding.ts). */
export function normalizeReport(report: Report): Report {
  return {
    ...report,
    verdict: {
      ...report.verdict,
      trust_score: report.verdict.rating === "nothing_to_check" ? NOTHING_TO_CHECK_SCORE : clampScore(report.verdict.trust_score),
      score_reason: report.verdict.score_reason.trim(),
      would_raise: report.verdict.rating === "nothing_to_check" ? "" : report.verdict.would_raise.trim(),
    },
    news: report.news && {
      ...report.news,
      score: clampScore(report.news.score),
      claims: report.news.claims.map((c) => ({ ...c, source_urls: c.source_urls.filter(Boolean) })),
    },
    vendor: report.vendor && { ...report.vendor, score: clampScore(report.vendor.score) },
    product: report.product && { ...report.product, score: clampScore(report.product.score) },
    media: report.media && {
      items: report.media.items.map((m) => ({ ...m, authenticity_score: clampScore(m.authenticity_score) })),
    },
    sources: report.sources.filter((s) => s.url.trim() !== ""),
    green_flags: report.green_flags.map((g) => g.trim()).filter(Boolean),
    background: {
      simple: report.background.simple.trim(),
      sections: report.background.sections.filter((s) => s.title.trim() && s.body.trim()),
    },
  };
}
