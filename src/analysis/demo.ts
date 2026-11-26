import type Anthropic from "@anthropic-ai/sdk";
import type { Report } from "./schema.js";
import type { Streamer } from "./analyzer.js";

type BetaMessage = Anthropic.Beta.BetaMessage;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

/**
 * Scripted stand-in for Claude, used by demo mode (TROONOOZ_DEMO=1) and the
 * test suite. It returns a fixed sample report regardless of the input, so the
 * UI and the request pipeline can be exercised without an API key. Every
 * sample is labelled as demo data and cites only example.org URLs.
 */

const DEMO_NOTICE = "DEMO MODE: this is a fixed sample report, not an analysis of what you submitted.";

export const SAMPLE_NEWS_REPORT: Report = {
  summary:
    `${DEMO_NOTICE} The post claims a shark was photographed swimming on a flooded highway after this week's hurricane. ` +
    "The same photo has circulated after several storms since 2011 and is a composite: the shark was pasted into a flood photo. The claim is false.",
  background: {
    simple:
      "Every time a big hurricane hits the US, the same photo of a shark swimming next to cars on a flooded highway goes viral again. " +
      "It started circulating in 2011 and has been re-shared with new captions for almost every major storm since.",
    sections: [
      {
        title: "How we got here",
        body: "The image first spread during Hurricane Irene in 2011. It was made by pasting a shark from an old magazine photo onto a real flood picture, and it has resurfaced during Sandy, Harvey, Florence, and later storms.",
      },
      {
        title: "Why it keeps circulating",
        body: "Storm coverage creates a rush of dramatic images, and alarming posts get shared before anyone checks them. Pages that post it often gain followers fast.",
      },
      {
        title: "Can sharks really end up on flooded roads?",
        body: "Very rarely, sharks have been filmed in flooded coastal areas. That is part of why this hoax is believable, but this particular picture is fake.",
      },
    ],
  },
  content: {
    type: "social_post",
    platform: "Facebook",
    author: "Storm Watch Daily (unverified page)",
    published: "Shown as \"2h\" in the screenshot",
    description:
      "A screenshot of a Facebook post showing a flooded multi-lane highway with a shark fin and body visible beside a car, captioned \"SHARK on I-95 right now!! Stay inside!!\".",
  },
  verdict: {
    rating: "untrustworthy",
    trust_score: 8,
    confidence: "high",
    headline: "Recycled hoax: doctored shark photo from 2011",
    score_reason: "Fact-checkers have traced the image to two older photos, and the page presents a years-old fake as happening now.",
    would_raise: "",
  },
  news: {
    rating: "false",
    score: 5,
    claims: [
      {
        claim: "A shark was swimming on the flooded I-95 during this week's hurricane.",
        rating: "contradicted",
        explanation:
          "The identical image appears in fact-checks dating back to Hurricane Irene in 2011. Local authorities have reported no shark sightings on flooded roads this week.",
        source_urls: ["https://example.org/fact-check/shark-highway-photo"],
      },
    ],
    source_assessment:
      "The page was created recently, has no listed owner, and mainly posts viral storm content with emergency-style captions. It is not affiliated with any news organization or weather service.",
    context: "The photo predates the current storm by many years and has been re-captioned for each new hurricane.",
    manipulation_tactics: ["False urgency (\"right now\", \"stay inside\")", "Fear-based engagement bait", "Recycled image presented as new"],
  },
  vendor: null,
  product: null,
  media: {
    items: [
      {
        ref: "img1",
        label: "Flood photo inside the post",
        rating: "manipulated",
        authenticity_score: 6,
        ai_generated_likelihood: "low",
        manipulation_likelihood: "very_high",
        findings: [
          { observation: "The shark's lighting comes from the upper left while the scene is lit by overcast, diffuse light.", signal: "suspicious" },
          { observation: "The water around the shark shows no wake or disturbance where the body meets the surface.", signal: "suspicious" },
          { observation: "The road signs and car models are consistent with a real US highway photo.", signal: "neutral" },
        ],
        provenance:
          "The shark element matches a 2005 magazine photo of a shark following a kayak; the flood background matches a different 2011 news photo.",
      },
    ],
  },
  red_flags: [
    { severity: "critical", category: "media", description: "The image is a known composite that has been debunked repeatedly." },
    { severity: "high", category: "news", description: "A years-old image is presented as happening \"right now\"." },
    { severity: "medium", category: "general", description: "The posting page is new and anonymous and relies on alarm-style captions." },
  ],
  green_flags: [],
  recommendations: [
    "Do not share the post; report it to the platform as false information.",
    "For storm conditions, follow your local emergency management agency and national weather service.",
  ],
  sources: [
    {
      title: "Fact check: the 'shark on the highway' photo is fake (example)",
      url: "https://example.org/fact-check/shark-highway-photo",
      supports: "Documents the image's history and the two original photos it was built from.",
    },
    {
      title: "Viral storm hoaxes to ignore (example)",
      url: "https://example.org/storm-hoaxes",
      supports: "Lists the shark photo among recurring hurricane hoaxes.",
    },
  ],
  limitations: [
    "Demo data: no real analysis was performed.",
    "Reverse image search was not available; provenance relies on published fact-checks.",
  ],
};

export const SAMPLE_VENDOR_REPORT: Report = {
  summary:
    `${DEMO_NOTICE} The ad promotes 90% off designer handbags from a "closing down" boutique. ` +
    "The store's domain was registered weeks ago, the product photos are copied from the brand's official site, and payment is only accepted by bank transfer. This matches a common online-store scam.",
  background: {
    simple:
      "This is a style of online-store scam that is common on social media: an ad for luxury goods at huge discounts that leads to a newly created website. " +
      "People who order usually receive nothing, or a cheap fake.",
    sections: [
      {
        title: "How these scams work",
        body: "Scammers copy photos from the real brand, build a store in a few hours, and pay for ads. They often close the site after a few weeks and reopen under a new name.",
      },
      {
        title: "Warning signs",
        body: "Very large discounts on luxury brands, countdown timers, a 'closing down' story, and payment by bank transfer only are the most common signs.",
      },
    ],
  },
  content: {
    type: "advertisement",
    platform: "Instagram",
    author: "luxebagsoutlet-sale",
    published: "Sponsored",
    description: "A sponsored post advertising designer handbags at 90% off with a countdown timer and a link to a web store.",
  },
  verdict: {
    rating: "untrustworthy",
    trust_score: 12,
    confidence: "high",
    headline: "Likely scam store: weeks-old site, stolen photos",
    score_reason: "The store's website is weeks old, its photos are copied from the brand, and it only takes bank transfers.",
    would_raise: "Independent reviews from real customers, or listing as an authorized retailer on the brand's own website.",
  },
  news: null,
  vendor: {
    name: "Luxe Bags Outlet",
    website: "luxebags-outlet.example",
    rating: "likely_scam",
    score: 10,
    reputation_summary:
      "No independent reviews exist for this store. Two consumer-forum threads describe orders that never arrived from an identically designed site under a different name.",
    offer_assessment: "Genuine designer bags do not sell at 90% off retail; authorized retailers rarely discount these brands at all.",
    green_flags: [],
    red_flags: [
      "Domain registered 23 days ago",
      "Product photos copied from the brand's official website",
      "Payment only by bank transfer (no buyer protection)",
      "Countdown timer and \"closing down\" story to create urgency",
      "No company address or registration details",
    ],
  },
  product: {
    name: "Designer leather handbags (as advertised)",
    rating: "poor",
    score: 15,
    summary: "The photos are copied from the brand's own site, so they show the real bag, not what this store ships. Buyers of look-alike stores report receiving cheap imitations or nothing.",
    pros: [],
    cons: ["Product photos are not of this store's stock", "No independent reviews of what customers actually received"],
  },
  media: null,
  red_flags: [
    { severity: "critical", category: "vendor", description: "The store's domain is only weeks old while claiming to be a long-running boutique." },
    { severity: "high", category: "vendor", description: "Bank-transfer-only payment means no way to recover money." },
  ],
  green_flags: [],
  recommendations: [
    "Do not buy from this store.",
    "If you already paid, contact your bank immediately and report the ad to the platform.",
    "Buy designer goods only from the brand or its authorized retailers.",
  ],
  sources: [
    {
      title: "How to spot fake online stores (example)",
      url: "https://example.org/fake-online-stores",
      supports: "Describes the same pattern of new domains, deep discounts, and transfer-only payment.",
    },
  ],
  limitations: ["Demo data: no real analysis was performed."],
};

export const SAMPLE_NOTHING_REPORT: Report = {
  verdict: {
    rating: "nothing_to_check",
    trust_score: 50,
    confidence: "high",
    headline: "An ordinary chat with nothing to fact-check",
    score_reason: "The screenshot shows a private conversation with no factual claims, nothing for sale, and no images whose authenticity matters.",
    would_raise: "",
  },
  summary: `${DEMO_NOTICE} This is a screenshot of an everyday chat. There is nothing in it to fact-check or worry about.`,
  background: {
    simple: "This is a conversation in a messaging or AI chat app. It contains everyday discussion rather than news, offers, or shared media.",
    sections: [],
  },
  content: {
    type: "message",
    platform: "Chat app",
    author: "",
    published: "",
    description: "A screenshot of a chat conversation.",
  },
  news: null,
  vendor: null,
  product: null,
  media: null,
  red_flags: [],
  green_flags: ["Ordinary conversation with nothing to verify"],
  recommendations: ["No action needed."],
  sources: [],
  limitations: ["Demo data: no real analysis was performed."],
};

let seq = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function message(content: ContentBlock[], stop: BetaMessage["stop_reason"]): BetaMessage {
  return {
    id: `msg_demo_${++seq}`,
    type: "message",
    role: "assistant",
    model: "demo",
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      fallback_credit: null,
      inference_geo: null,
      iterations: null,
      output_tokens_details: null,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
      service_tier: "standard",
      speed: null,
    },
  } as BetaMessage;
}

/** Pick the sample that best matches the request, then replay it with realistic pacing. */
export function demoStreamer(opts: { delayMs?: number } = {}): Streamer {
  const delay = opts.delayMs ?? 700;
  return async (params, hooks) => {
    const first = params.messages[0]?.content ?? "";
    const userText =
      typeof first === "string" ? first : first.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const wantsVendor = /Focus requested by the user: vendor/.test(userText) || /closing down|discount|% off|\bshop\b|\bstore\b/i.test(userText);
    const wantsNothing = /\bnothing to (?:check|verify)\b/i.test(userText);
    const sample = wantsNothing ? SAMPLE_NOTHING_REPORT : wantsVendor ? SAMPLE_VENDOR_REPORT : SAMPLE_NEWS_REPORT;
    const hasWeb = params.tools?.some((t) => "name" in t && t.name === "web_search") ?? false;

    const blocks: ContentBlock[] = [];
    const emit = async (block: ContentBlock) => {
      hooks.onBlockStart?.(block);
      await sleep(delay);
      hooks.onBlock?.(block);
      blocks.push(block);
    };

    await emit({ type: "thinking", thinking: "", signature: "demo" } as ContentBlock);
    if (hasWeb) {
      const query = wantsVendor ? "Luxe Bags Outlet reviews scam" : "shark on flooded highway photo fact check";
      await emit({ type: "server_tool_use", id: "srvtoolu_demo_1", name: "web_search", input: { query } } as ContentBlock);
      await emit({
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_demo_1",
        content: sample.sources.map((s) => ({
          type: "web_search_result",
          url: s.url,
          title: s.title,
          encrypted_content: "",
          page_age: null,
        })),
      } as ContentBlock);
    }
    // Stream the report the way the API does, verdict first, so the early-verdict view can be tried in demo mode.
    const submit = { type: "tool_use", id: "toolu_demo_1", name: "submit_report", input: sample } as ContentBlock;
    hooks.onBlockStart?.(submit);
    const { verdict, summary, ...rest } = sample;
    const json = JSON.stringify({ verdict, summary, ...rest });
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      await sleep(delay / 3);
      hooks.onToolInputDelta?.("submit_report", json.slice(Math.floor((i * json.length) / steps), Math.floor(((i + 1) * json.length) / steps)));
    }
    hooks.onBlock?.(submit);
    blocks.push(submit);
    return message(blocks, "tool_use");
  };
}
