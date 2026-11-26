import { externalLink, h, hostOf, svg } from "./dom.js";

const OVERALL = {
  trustworthy: ["Trustworthy", "good"],
  mostly_trustworthy: ["Mostly trustworthy", "ok"],
  mixed: ["Mixed", "caution"],
  questionable: ["Questionable", "warn"],
  untrustworthy: ["Untrustworthy", "bad"],
  unverifiable: ["Unverifiable", "neutral"],
  nothing_to_check: ["Nothing to verify", "neutral"],
};

/** "Nothing to verify" verdicts have no meaningful number, so they show a dash. */
export function scoreText(score, rating) {
  return rating === "nothing_to_check" ? "\u2013" : String(score);
}

export function scoreAria(score, rating) {
  return rating === "nothing_to_check" ? "Nothing to verify" : `Trust score ${score}`;
}

const NEWS = {
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

const CLAIM = {
  supported: ["Supported", "good"],
  partly_supported: ["Partly supported", "caution"],
  unsupported: ["Unsupported", "warn"],
  contradicted: ["Contradicted", "bad"],
  unverifiable: ["Unverifiable", "neutral"],
  opinion: ["Opinion", "neutral"],
};

const VENDOR = {
  reputable: ["Reputable", "good"],
  established: ["Established", "ok"],
  mixed: ["Mixed reputation", "caution"],
  caution: ["Use caution", "warn"],
  high_risk: ["High risk", "bad"],
  likely_scam: ["Likely scam", "bad"],
  unknown: ["Unknown", "neutral"],
};

const MEDIA = {
  likely_authentic: ["Likely authentic", "good"],
  edited: ["Edited", "caution"],
  manipulated: ["Manipulated", "bad"],
  ai_generated: ["AI-generated", "bad"],
  out_of_context: ["Out of context", "warn"],
  fabricated_screenshot: ["Fabricated screenshot", "bad"],
  inconclusive: ["Inconclusive", "neutral"],
};

const SEVERITY = {
  critical: ["Critical", "bad"],
  high: ["High", "warn"],
  medium: ["Medium", "caution"],
  low: ["Low", "neutral"],
};

const CONTENT_TYPES = {
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

const LIKELIHOOD_STEPS = { very_low: 1, low: 2, moderate: 3, high: 4, very_high: 5, unknown: 0 };
const LIKELIHOOD_LABEL = {
  very_low: "Very low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

export function scoreTone(score, rating) {
  if (rating === "unverifiable" || rating === "nothing_to_check") return "neutral";
  if (score >= 85) return "good";
  if (score >= 70) return "ok";
  if (score >= 50) return "caution";
  if (score >= 30) return "warn";
  return "bad";
}

const TONE_VAR = {
  good: "var(--good)",
  ok: "var(--ok)",
  caution: "var(--caution)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  neutral: "var(--neutral)",
};

function badge(map, key, extra = "") {
  const [label, tone] = map[key] ?? [key, "neutral"];
  return h("span", { class: `badge tone-${tone} ${extra}`.trim() }, label);
}

function gauge(score, rating) {
  if (rating === "nothing_to_check") {
    return h(
      "div",
      { class: "gauge gauge-none", role: "img", "aria-label": "Nothing to verify" },
      h("div", { class: "gauge-label" }, h("span", { class: "gauge-check", "aria-hidden": "true" }, "\u2713"), h("span", { class: "gauge-caption" }, "Nothing to verify")),
    );
  }
  const tone = scoreTone(score, rating);
  const r = 62;
  const c = 2 * Math.PI * r;
  const value = svg("circle", {
    class: "gauge-value",
    cx: 74,
    cy: 74,
    r,
    stroke: TONE_VAR[tone],
    "stroke-dasharray": c,
    "stroke-dashoffset": c,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => value.setAttribute("stroke-dashoffset", String(c * (1 - score / 100)))));
  return h(
    "div",
    { class: "gauge", role: "img", "aria-label": `Trust score ${score} out of 100` },
    svg("svg", { viewBox: "0 0 148 148" }, svg("circle", { class: "gauge-track", cx: 74, cy: 74, r }), value),
    h("div", { class: "gauge-label" }, h("span", { class: "gauge-score", style: { color: TONE_VAR[tone] } }, score), h("span", { class: "gauge-caption" }, "Trust score")),
  );
}

function scoreBar(score, label = "Score") {
  const tone = scoreTone(score);
  return h(
    "span",
    { class: "section-score", title: `${label}: ${score}/100` },
    h("span", { class: "bar", "aria-hidden": "true" }, h("span", { style: { width: `${score}%`, background: TONE_VAR[tone] } })),
    `${score}/100`,
  );
}

function section(title, ...body) {
  return h("section", { class: "card section" }, h("h2", {}, ...[title].flat()), ...body);
}

function list(items) {
  return h("ul", { class: "list" }, items.map((i) => h("li", {}, i)));
}

function likelihoodMeter(label, value) {
  const steps = LIKELIHOOD_STEPS[value] ?? 0;
  const color = steps >= 4 ? "var(--bad)" : steps === 3 ? "var(--caution)" : steps > 0 ? "var(--good)" : "var(--neutral)";
  return h(
    "div",
    { class: "meter" },
    h("div", { class: "meter-label" }, h("span", {}, label), h("strong", {}, LIKELIHOOD_LABEL[value] ?? value)),
    h(
      "div",
      { class: "meter-steps", "aria-hidden": "true" },
      [1, 2, 3, 4, 5].map((i) => h("span", { style: i <= steps ? { background: color } : {} })),
    ),
  );
}

function renderNews(news, sourceSeen) {
  const claims = news.claims.length
    ? h(
        "ol",
        { class: "claims" },
        news.claims.map((c) =>
          h(
            "li",
            { class: "claim" },
            h("div", { class: "claim-head" }, h("p", { class: "claim-text" }, c.claim), badge(CLAIM, c.rating)),
            h("p", {}, c.explanation),
            c.source_urls.length
              ? h(
                  "div",
                  { class: "claim-sources" },
                  c.source_urls.map((u) => h("span", {}, externalLink(u, hostOf(u)), sourceSeen(u) ? null : " (not in research results)")),
                )
              : null,
          ),
        ),
      )
    : h("p", { class: "muted" }, "No specific checkable claims were identified.");

  return section(
    ["News & claims", badge(NEWS, news.rating), scoreBar(news.score)],
    h("h3", {}, "Claims checked"),
    claims,
    news.source_assessment ? [h("h3", {}, "Who published it"), h("p", {}, news.source_assessment)] : null,
    news.context ? [h("h3", {}, "Missing context"), h("p", {}, news.context)] : null,
    news.manipulation_tactics.length ? [h("h3", {}, "Manipulation tactics"), list(news.manipulation_tactics)] : null,
  );
}

function renderVendor(v) {
  const identity = [v.name, v.website].filter(Boolean).join(" · ");
  return section(
    ["Seller / vendor", badge(VENDOR, v.rating), scoreBar(v.score)],
    identity ? h("p", {}, h("strong", {}, identity)) : null,
    v.reputation_summary ? [h("h3", {}, "Reputation"), h("p", {}, v.reputation_summary)] : null,
    v.offer_assessment ? [h("h3", {}, "The offer"), h("p", {}, v.offer_assessment)] : null,
    v.green_flags.length || v.red_flags.length
      ? h(
          "div",
          { class: "two-col" },
          h("div", { class: "flag-col bad" }, h("h3", {}, "Red flags"), v.red_flags.length ? list(v.red_flags) : h("p", { class: "muted" }, "None found")),
          h("div", { class: "flag-col good" }, h("h3", {}, "Green flags"), v.green_flags.length ? list(v.green_flags) : h("p", { class: "muted" }, "None found")),
        )
      : null,
  );
}

function renderMedia(media) {
  return section(
    "Image & video authenticity",
    media.items.map((m) =>
      h(
        "div",
        { class: "media-item" },
        h(
          "div",
          { class: "media-head" },
          h("h3", {}, m.label),
          badge(MEDIA, m.rating),
          h("span", { class: "badge tone-neutral" }, m.ref),
          scoreBar(m.authenticity_score, "Authenticity"),
        ),
        h("div", { class: "meters" }, likelihoodMeter("AI-generated", m.ai_generated_likelihood), likelihoodMeter("Edited or manipulated", m.manipulation_likelihood)),
        m.findings.length
          ? h(
              "ul",
              { class: "findings" },
              m.findings.map((f) =>
                h("li", { class: "finding" }, h("span", { class: `dot ${f.signal}`, title: f.signal, "aria-label": f.signal }), h("span", {}, f.observation)),
              ),
            )
          : null,
        m.provenance ? h("p", {}, h("strong", {}, "Origin: "), m.provenance) : null,
      ),
    ),
  );
}

function renderSignals(record) {
  const items = [];
  for (const s of record.signals ?? []) {
    items.push(
      h(
        "li",
        {},
        h("strong", {}, `${s.id} `),
        `${s.label}: `,
        s.provenance.length ? h("span", { class: "signal-provenance" }, s.provenance.join("; ")) : "no embedded provenance",
        s.notes.length ? ` · ${s.notes.join("; ")}` : "",
      ),
    );
  }
  for (const d of record.domains ?? []) {
    let text;
    if (d.error) text = `registration data unavailable`;
    else if (d.ageDays === null) text = "registration date not published";
    else {
      const age = d.ageDays < 365 ? `${d.ageDays} days` : `${(d.ageDays / 365.25).toFixed(1)} years`;
      text = `registered ${d.registered} (${age} ago)${d.registrar ? ` via ${d.registrar}` : ""}`;
    }
    const young = d.ageDays !== null && d.ageDays < 180;
    items.push(h("li", {}, h("strong", {}, `${d.domain}: `), young ? h("span", { class: "signal-provenance" }, text) : text));
  }
  if (!items.length) return null;
  return section("Automated checks", h("p", { class: "muted" }, "Metadata and domain records checked before the AI analysis. Missing metadata is normal and proves nothing."), h("ul", { class: "signals" }, items));
}

/** What moved the score, and what would raise it. Older reports have neither. */
function scoreWhy(verdict) {
  if (!verdict.score_reason && !verdict.would_raise) return null;
  const none = verdict.rating === "nothing_to_check";
  return h(
    "div",
    { class: "score-why" },
    verdict.score_reason ? h("p", {}, h("strong", {}, none ? "Why there's no score: " : "Why this score: "), verdict.score_reason) : null,
    !none && verdict.would_raise ? h("p", {}, h("strong", {}, "What would raise it: "), verdict.would_raise) : null,
  );
}

/** The bottom line and plain-language context, with deeper sections behind "Explain more". Older reports have no background. */
function renderWhatsGoingOn(rep) {
  const bg = rep.background;
  return h(
    "section",
    { class: "card section background" },
    h("h2", {}, "What's going on"),
    h("p", { class: "background-summary" }, rep.summary),
    bg?.simple ? h("p", { class: "background-simple" }, bg.simple) : null,
    scoreWhy(rep.verdict),
    bg?.sections?.length
      ? h(
          "details",
          { class: "explain" },
          h("summary", {}, h("span", { class: "explain-more" }, "Explain more"), h("span", { class: "explain-less" }, "Show less")),
          h(
            "div",
            { class: "explain-body" },
            bg.sections.map((s) => h("div", { class: "explain-section" }, h("h3", {}, s.title), h("p", {}, s.body))),
          ),
        )
      : null,
  );
}

/** Other checks of the same story (claim, event, media, or offer). */
function renderStory(record) {
  const story = record.story;
  if (!story || story.members.length < 2) return null;
  const others = story.members.filter((m) => m.id !== record.id);
  return section(
    ["Related checks", h("span", { class: "badge tone-neutral" }, `${story.checks} checks of this story`)],
    h("p", { class: "muted" }, "Other submissions troonooz recognised as the same story. Verdicts can differ as a story develops."),
    h(
      "ul",
      { class: "related" },
      others.slice(0, 10).map((m) =>
        h(
          "li",
          {},
          h(
            "a",
            { href: `#/report/${m.id}` },
            h("span", { class: `score-pill tone-${scoreTone(m.trust_score, m.rating)}`, "aria-label": scoreAria(m.trust_score, m.rating) }, scoreText(m.trust_score, m.rating)),
            h("span", { class: "related-text" }, h("span", { class: "related-title" }, m.headline), h("span", { class: "related-date" }, new Date(m.created_at).toLocaleString(), m.disputed ? " \u00b7 flagged as possibly wrong" : "")),
          ),
        ),
      ),
    ),
  );
}

function renderSources(report) {
  if (!report.sources.length) return null;
  return section(
    "Sources",
    h(
      "ol",
      { class: "sources" },
      report.sources.map((s) =>
        h(
          "li",
          { class: "source" },
          externalLink(s.url, s.title || s.url),
          h(
            "span",
            { class: "source-host" },
            hostOf(s.url),
            s.seen
              ? h("span", { class: "badge tone-good" }, "Found in research")
              : h("span", { class: "badge tone-caution", title: "This URL did not appear in the search or fetch results for this check. Verify it before relying on it." }, "Not in research results"),
          ),
          s.supports ? h("p", {}, s.supports) : null,
        ),
      ),
    ),
  );
}

function timingText(t) {
  const s = (ms) => `${Math.round(ms / 1000)}s`;
  const parts = [`researching ${s(t.research_ms)}`, `writing the report ${s(t.writing_ms)}`, `preparing ${s(t.prepare_ms)}`];
  if (t.reuse_ms >= 500) parts.push(`checking earlier results ${s(t.reuse_ms)}`);
  return `${s(t.total_ms)} in total: ${parts.join(", ")}`;
}

function renderResearch(record) {
  const r = record.research ?? { queries: [], fetched: [] };
  const u = record.usage ?? {};
  const secs = record.duration_ms ? Math.round(record.duration_ms / 1000) : null;
  return h(
    "details",
    { class: "card research" },
    h(
      "summary",
      {},
      `How this check was done · ${record.input?.mode === "quick" ? "Quick check · " : ""}${r.queries.length} search${r.queries.length === 1 ? "" : "es"}, ${r.fetched.length} page${r.fetched.length === 1 ? "" : "s"} read${record.zooms ? `, ${record.zooms} zoom-in${record.zooms === 1 ? "" : "s"}` : ""}${r.lookups?.length ? `, ${r.lookups.length} earlier-findings lookup${r.lookups.length === 1 ? "" : "s"}` : ""}`,
    ),
    h(
      "div",
      { class: "research-body" },
      r.lookups?.length ? h("div", {}, h("strong", {}, "Earlier findings searched: "), r.lookups.map((q, i) => [i ? ", " : "", h("code", {}, q)])) : null,
      r.queries.length ? h("div", {}, h("strong", {}, "Searches: "), r.queries.map((q, i) => [i ? ", " : "", h("code", {}, q)])) : null,
      r.fetched.length ? h("div", {}, h("strong", {}, "Pages read: "), r.fetched.map((f, i) => [i ? ", " : "", externalLink(f, hostOf(f))])) : null,
      h(
        "div",
        {},
        `Model: ${record.model}`,
        secs !== null ? ` · ${secs}s` : "",
        u.input_tokens !== undefined ? ` · ${(u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)).toLocaleString()} input / ${u.output_tokens.toLocaleString()} output tokens` : "",
        record.input?.web_research === false ? " · web research off" : "",
      ),
      record.timing ? h("div", {}, h("strong", {}, "Time: "), timingText(record.timing)) : null,
      record.input?.notes?.length ? h("div", {}, h("strong", {}, "Processing notes: "), record.input.notes.join(" ")) : null,
    ),
  );
}

/** Render a full analysis record into `root`. */
export function renderReport(root, record, actions) {
  const rep = record.report;
  const seen = new Set(rep.sources.filter((s) => s.seen).map((s) => s.url));
  const unseen = new Set(record.research?.unseenCitedUrls ?? []);
  const sourceSeen = (u) => seen.has(u) || !unseen.has(u);
  const thumbs = (record.input?.thumbnails ?? []).filter((t) => t.dataUrl || t.url);
  const c = rep.content;

  const facts = [
    ["Type", CONTENT_TYPES[c.type] ?? c.type],
    ["Platform", c.platform],
    ["Posted by", c.author],
    ["Published", c.published],
  ].filter(([, v]) => v);

  const children = [
    record.demo ? h("div", { class: "demo-flag", role: "note" }, "Demo mode: this is a fixed sample report, not an analysis of what was submitted.") : null,
    record.disputed
      ? h(
          "div",
          { class: "demo-flag", role: "note" },
          `A user flagged this result as possibly wrong (${new Date(record.disputed.at).toLocaleDateString()})${record.disputed.note ? `: \u201c${record.disputed.note}\u201d` : ""}. It won't be reused for other people's checks.`,
        )
      : null,
    h(
      "section",
      { class: "card verdict" },
      gauge(rep.verdict.trust_score, rep.verdict.rating),
      h(
        "div",
        {},
        h(
          "div",
          { class: "verdict-rating" },
          badge(OVERALL, rep.verdict.rating, "badge-lg"),
          rep.verdict.rating === "nothing_to_check"
            ? null
            : h("span", { class: "badge tone-neutral" }, `${rep.verdict.confidence[0].toUpperCase()}${rep.verdict.confidence.slice(1)} confidence`),
        ),
        h("h1", {}, rep.verdict.headline),
      ),
    ),
    renderWhatsGoingOn(rep),
    rep.red_flags.length
      ? section(
          "Red flags",
          h(
            "ul",
            { class: "flags" },
            rep.red_flags.map((f) => h("li", { class: "flag" }, badge(SEVERITY, f.severity), h("span", {}, f.description))),
          ),
        )
      : null,
    section(
      "What was checked",
      h(
        "div",
        { class: "content-card" },
        thumbs.length
          ? h(
              "div",
              { class: "thumbs" },
              thumbs.map((t) =>
                h(
                  "figure",
                  { class: "thumb" },
                  h("img", { src: t.dataUrl ?? t.url, alt: t.label, loading: "lazy", referrerpolicy: "no-referrer" }),
                  h("figcaption", {}, h("span", { class: "thumb-id" }, t.id), ` ${t.label}`),
                ),
              ),
            )
          : null,
        facts.length ? h("dl", { class: "facts" }, facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null,
        h("p", {}, c.description),
        record.input?.page?.url ? h("p", { class: "muted" }, "Page: ", externalLink(record.input.page.url, record.input.page.title || record.input.page.url)) : null,
      ),
    ),
    rep.news ? renderNews(rep.news, sourceSeen) : null,
    rep.vendor ? renderVendor(rep.vendor) : null,
    rep.media && rep.media.items.length ? renderMedia(rep.media) : null,
    rep.recommendations.length ? section("What to do", list(rep.recommendations)) : null,
    renderStory(record),
    renderSignals(record),
    renderSources(rep),
    rep.limitations.length ? section("Limitations", list(rep.limitations)) : null,
    renderResearch(record),
    h(
      "div",
      { class: "report-actions" },
      h("a", { class: "btn btn-primary", href: "#/" }, "Check something else"),
      h("button", { type: "button", class: "btn", onclick: actions.copyLink }, "Copy link"),
      h("button", { type: "button", class: "btn", onclick: actions.copySummary }, "Copy summary"),
      h("button", { type: "button", class: "btn", onclick: actions.dispute, disabled: Boolean(record.disputed) }, record.disputed ? "Flagged as possibly wrong" : "Report a problem"),
      h("button", { type: "button", class: "btn", onclick: actions.remove }, "Delete"),
    ),
  ];
  // replaceChildren would render null as the text "null".
  root.replaceChildren(...children.filter(Boolean));
}

export function summaryText(record) {
  const r = record.report;
  const [label] = OVERALL[r.verdict.rating] ?? [r.verdict.rating];
  const score = r.verdict.rating === "nothing_to_check" ? "" : ` (${r.verdict.trust_score}/100)`;
  const lines = [`troonooz: ${label}${score}`, r.verdict.headline, "", r.summary];
  if (r.verdict.score_reason) lines.push("", `Why: ${r.verdict.score_reason}`);
  if (r.red_flags.length) {
    lines.push("", "Red flags:");
    for (const f of r.red_flags) lines.push(`- ${f.description}`);
  }
  if (r.sources.length) {
    lines.push("", "Sources:");
    for (const s of r.sources) lines.push(`- ${s.title}: ${s.url}`);
  }
  return lines.join("\n");
}

export { OVERALL, CONTENT_TYPES };
