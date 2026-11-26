import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import { Alert, Animated, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { DeckCard } from "./CardDeck";
import { Badge, Body, Bullet, Button, ScoreBar, SectionLabel } from "./ui";
import type { Client } from "../lib/api";
import { CLAIM, CONTENT_TYPES, LIKELIHOOD, MEDIA, NEWS, OVERALL, PRODUCT, SEVERITY, VENDOR, hostOf, label, scoreText, scoreTone, timeAgo, type Tone } from "../lib/labels";
import { useColors } from "../lib/theme";
import type { AnalysisRecord, Report } from "../lib/types";

export function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  void WebBrowser.openBrowserAsync(url).catch(() => {});
}

/** The cards for one report, in reading order; sections the report doesn't have are left out. */
export function reportCards(record: AnalysisRecord, opts: { client: Client | null; reduceMotion: boolean; onDisputed(): void }): DeckCard[] {
  const r = record.report;
  const nothing = r.verdict.rating === "nothing_to_check";
  const cards: DeckCard[] = [
    { key: "verdict", title: "Verdict", icon: "⚖️", tone: scoreTone(r.verdict.trust_score, r.verdict.rating), render: () => <VerdictCard record={record} reduceMotion={opts.reduceMotion} /> },
  ];
  const green = r.green_flags ?? [];
  if (r.red_flags.length || green.length) {
    cards.push({ key: "flags", title: "Red & green flags", icon: "\u{1F6A9}", tone: r.red_flags.length ? "bad" : "good", render: () => <FlagsCard report={r} /> });
  }
  const scores = scoreRows(r);
  if (scores.length) {
    cards.push({ key: "scores", title: "Scores", icon: "\u{1F4CA}", render: (api) => <ScoresCard rows={scores} onOpen={api.goTo} /> });
  }
  cards.push({ key: "story", title: "What's going on", icon: "\u{1F4A1}", render: () => <StoryCard record={record} /> });
  if (r.news) cards.push({ key: "news", title: "The claims", icon: "\u{1F4F0}", tone: scoreTone(r.news.score), render: () => <ClaimsCard report={r} /> });
  if (r.vendor) cards.push({ key: "vendor", title: "The seller", icon: "\u{1F3EA}", tone: scoreTone(r.vendor.score), render: () => <SellerCard report={r} /> });
  if (r.product) cards.push({ key: "product", title: "The product", icon: "\u{1F4E6}", tone: scoreTone(r.product.score), render: () => <ProductCard report={r} /> });
  if (r.media?.items.length) cards.push({ key: "media", title: "Images & video", icon: "\u{1F5BC}️", render: () => <MediaCard report={r} /> });
  if (!nothing || r.recommendations.length) {
    cards.push({ key: "next", title: "What to do", icon: "✅", render: () => <NextCard record={record} client={opts.client} onDisputed={opts.onDisputed} /> });
  }
  if (r.sources.length) cards.push({ key: "sources", title: "Sources", icon: "\u{1F517}", render: () => <SourcesCard report={r} /> });
  const related = (record.story?.members ?? []).filter((m) => m.id !== record.id);
  if (related.length) cards.push({ key: "related", title: "Related checks", icon: "\u{1F9E9}", render: () => <RelatedCard record={record} /> });
  return cards;
}

function VerdictCard({ record, reduceMotion }: { record: AnalysisRecord; reduceMotion: boolean }) {
  const c = useColors();
  const v = record.report.verdict;
  const nothing = v.rating === "nothing_to_check";
  const tone = scoreTone(v.trust_score, v.rating);
  const [ratingLabel] = label(OVERALL, v.rating);
  const flip = useRef(new Animated.Value(0)).current;
  const [back, setBack] = useState(false);
  const [height, setHeight] = useState(0);

  const toggle = () => {
    const next = !back;
    setBack(next);
    if (reduceMotion) flip.setValue(next ? 1 : 0);
    else Animated.spring(flip, { toValue: next ? 1 : 0, useNativeDriver: Platform.OS !== "web", friction: 8, tension: 40 }).start();
  };
  const front = { transform: [{ perspective: 1200 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) }] };
  const rear = { transform: [{ perspective: 1200 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] }) }] };
  const meta = [
    record.input.mode === "quick" ? "Quick check" : "Thorough check",
    timeAgo(record.created_at),
    record.duration_ms ? `took ${Math.round(record.duration_ms / 1000)}s` : "",
    record.demo ? "sample data" : "",
  ].filter(Boolean);

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={back ? "Why this score. Tap to show the score again." : `${ratingLabel}${nothing ? "" : `, trust score ${v.trust_score} out of 100`}. ${v.headline}. Tap to see why.`}
      style={{ minHeight: height || undefined }}
    >
      <Animated.View style={[styles.face, front, { backgroundColor: c.toneSoft[tone] }]} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        <Text style={[styles.faceLabel, { color: c.tone[tone] }]}>{nothing ? "Nothing to verify" : "Trust score"}</Text>
        {nothing ? (
          <Text style={[styles.bigScore, { color: c.tone[tone] }]}>{"✓"}</Text>
        ) : (
          <Text style={[styles.bigScore, { color: c.tone[tone] }]}>
            {v.trust_score}
            <Text style={[styles.outOf, { color: c.text3 }]}>/100</Text>
          </Text>
        )}
        {nothing ? null : <ScoreBar score={v.trust_score} tone={tone} height={10} />}
        <View style={styles.badges}>
          <Badge text={ratingLabel} tone={tone} plain />
          <Badge text={`${v.confidence[0]!.toUpperCase()}${v.confidence.slice(1)} confidence`} tone="neutral" plain />
        </View>
        <Text style={[styles.headline, { color: c.text }]}>{v.headline}</Text>
        <Text style={[styles.hint, { color: c.text3 }]}>Tap to see why {"↺"}</Text>
      </Animated.View>
      <Animated.View style={[styles.face, styles.rear, rear, { backgroundColor: c.surface2 }]} pointerEvents="none">
        <SectionLabel>{nothing ? "Why there's nothing to check" : "Why this score"}</SectionLabel>
        <Body>{v.score_reason || "No explanation was given for this score."}</Body>
        {!nothing && v.would_raise ? (
          <>
            <SectionLabel>What would raise it</SectionLabel>
            <Body>{v.would_raise}</Body>
          </>
        ) : null}
        <Text style={[styles.meta, { color: c.text3 }]}>{meta.join(" · ")}</Text>
        {record.disputed ? <Text style={[styles.meta, { color: c.tone.warn }]}>You flagged this result as possibly wrong.</Text> : null}
        <Text style={[styles.hint, { color: c.text3 }]}>Tap to flip back {"↺"}</Text>
      </Animated.View>
    </Pressable>
  );
}

function FlagsCard({ report }: { report: Report }) {
  const c = useColors();
  const green = report.green_flags ?? [];
  return (
    <View>
      <SectionLabel>Red flags</SectionLabel>
      {report.red_flags.length ? (
        report.red_flags.map((f, i) => {
          const [sev, tone] = label(SEVERITY, f.severity);
          return (
            <View key={i} style={styles.flagRow}>
              <View style={[styles.sevDot, { backgroundColor: c.tone[tone === "neutral" ? "caution" : tone] }]} />
              <View style={{ flex: 1 }}>
                <Body>{f.description}</Body>
                <Text style={[styles.small, { color: c.text3 }]}>{sev}</Text>
              </View>
            </View>
          );
        })
      ) : (
        <Body muted>None found.</Body>
      )}
      <SectionLabel>Green flags</SectionLabel>
      {green.length ? (
        green.map((g, i) => (
          <Bullet key={i} mark={"✓"} color={c.tone.good}>
            {g}
          </Bullet>
        ))
      ) : (
        <Body muted>None found.</Body>
      )}
    </View>
  );
}

interface ScoreRow {
  key: string;
  label: string;
  score: number;
  rating: string;
  tone: Tone;
}

function scoreRows(r: Report): ScoreRow[] {
  const rows: ScoreRow[] = [];
  if (r.news) rows.push({ key: "news", label: "Article confidence", score: r.news.score, rating: label(NEWS, r.news.rating)[0], tone: scoreTone(r.news.score) });
  if (r.vendor) rows.push({ key: "vendor", label: "Vendor score", score: r.vendor.score, rating: label(VENDOR, r.vendor.rating)[0], tone: scoreTone(r.vendor.score) });
  if (r.product) rows.push({ key: "product", label: "Product quality", score: r.product.score, rating: label(PRODUCT, r.product.rating)[0], tone: scoreTone(r.product.score) });
  const media = r.media?.items ?? [];
  if (media.length) {
    const avg = Math.round(media.reduce((s, m) => s + m.authenticity_score, 0) / media.length);
    rows.push({ key: "media", label: "Image authenticity", score: avg, rating: media.length === 1 ? label(MEDIA, media[0]!.rating)[0] : `${media.length} items`, tone: scoreTone(avg) });
  }
  return rows;
}

function ScoresCard({ rows, onOpen }: { rows: ScoreRow[]; onOpen(key: string): void }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          onPress={() => onOpen(row.key)}
          accessibilityRole="button"
          accessibilityLabel={`${row.label}: ${row.score} out of 100, ${row.rating}. Show details.`}
          style={({ pressed }) => [styles.scoreRow, { backgroundColor: c.surface2, opacity: pressed ? 0.8 : 1 }]}
        >
          <View style={styles.scoreHead}>
            <Text style={[styles.scoreLabel, { color: c.text }]}>{row.label}</Text>
            <Text style={[styles.scoreValue, { color: c.tone[row.tone] }]}>{row.score}</Text>
          </View>
          <ScoreBar score={row.score} tone={row.tone} />
          <View style={styles.scoreFoot}>
            <Text style={[styles.small, { color: c.text2 }]}>{row.rating}</Text>
            <Text style={[styles.small, { color: c.accent }]}>Details {"›"}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function StoryCard({ record }: { record: AnalysisRecord }) {
  const c = useColors();
  const r = record.report;
  const [more, setMore] = useState(false);
  const thumb = record.input.thumbnails.find((t) => t.dataUrl);
  const sections = r.background?.sections ?? [];
  const about = [CONTENT_TYPES[r.content.type], r.content.platform, r.content.author, r.content.published].filter(Boolean).join(" · ");
  return (
    <View>
      {thumb?.dataUrl ? <Image source={{ uri: thumb.dataUrl }} style={[styles.thumb, { backgroundColor: c.surface2 }]} resizeMode="contain" accessibilityLabel={`What was checked: ${thumb.label}`} /> : null}
      {about ? <Text style={[styles.small, { color: c.text3, marginBottom: 8 }]}>{about}</Text> : null}
      <Body style={styles.lead}>{r.summary}</Body>
      {r.background?.simple ? <Body style={{ marginTop: 10 }}>{r.background.simple}</Body> : null}
      {sections.length ? (
        <>
          <Button title={more ? "Show less" : "Explain more"} kind="secondary" onPress={() => setMore(!more)} style={{ marginTop: 14 }} />
          {more
            ? sections.map((s, i) => (
                <View key={i}>
                  <SectionLabel>{s.title}</SectionLabel>
                  <Body>{s.body}</Body>
                </View>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}

function ClaimsCard({ report }: { report: Report }) {
  const c = useColors();
  const n = report.news!;
  const [rating, tone] = label(NEWS, n.rating);
  return (
    <View>
      <View style={styles.scoreHead}>
        <Badge text={rating} tone={tone} />
        <Text style={[styles.scoreValue, { color: c.tone[scoreTone(n.score)] }]}>{n.score}</Text>
      </View>
      <ScoreBar score={n.score} tone={scoreTone(n.score)} />
      {n.claims.map((cl, i) => {
        const [b, t] = label(CLAIM, cl.rating);
        return (
          <View key={i} style={[styles.claim, { borderLeftColor: c.tone[t] }]}>
            <Text style={[styles.claimText, { color: c.text }]}>{"“"}{cl.claim}{"”"}</Text>
            <Badge text={b} tone={t} />
            <Body muted style={{ marginTop: 4 }}>
              {cl.explanation}
            </Body>
            {cl.source_urls.length ? (
              <Text style={[styles.small, { color: c.text3 }]}>
                {cl.source_urls.length} source{cl.source_urls.length === 1 ? "" : "s"}: {cl.source_urls.map(hostOf).join(", ")}
              </Text>
            ) : null}
          </View>
        );
      })}
      {n.source_assessment ? (
        <>
          <SectionLabel>Who posted it</SectionLabel>
          <Body>{n.source_assessment}</Body>
        </>
      ) : null}
      {n.context ? (
        <>
          <SectionLabel>Missing context</SectionLabel>
          <Body>{n.context}</Body>
        </>
      ) : null}
      {n.manipulation_tactics.length ? (
        <>
          <SectionLabel>Manipulation tactics</SectionLabel>
          <View style={styles.chips}>
            {n.manipulation_tactics.map((m, i) => (
              <Badge key={i} text={m} tone="warn" />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function SellerCard({ report }: { report: Report }) {
  const c = useColors();
  const v = report.vendor!;
  const [rating, tone] = label(VENDOR, v.rating);
  const site = v.website ? (/^https?:\/\//i.test(v.website) ? v.website : `https://${v.website}`) : "";
  return (
    <View>
      <Text style={[styles.cardHeadline, { color: c.text }]}>{v.name || "Unknown seller"}</Text>
      {site ? (
        <Pressable onPress={() => openLink(site)} accessibilityRole="link">
          <Text style={[styles.link, { color: c.accent }]}>{hostOf(site)}</Text>
        </Pressable>
      ) : null}
      <View style={[styles.scoreHead, { marginTop: 8 }]}>
        <Badge text={rating} tone={tone} />
        <Text style={[styles.scoreValue, { color: c.tone[scoreTone(v.score)] }]}>{v.score}</Text>
      </View>
      <ScoreBar score={v.score} tone={scoreTone(v.score)} />
      <SectionLabel>Reputation</SectionLabel>
      <Body>{v.reputation_summary}</Body>
      {v.offer_assessment ? (
        <>
          <SectionLabel>The offer</SectionLabel>
          <Body>{v.offer_assessment}</Body>
        </>
      ) : null}
      {v.red_flags.length ? <SectionLabel>Concerns</SectionLabel> : null}
      {v.red_flags.map((f, i) => (
        <Bullet key={i} mark={"!"} color={c.tone.warn}>
          {f}
        </Bullet>
      ))}
      {v.green_flags.length ? <SectionLabel>Reassuring</SectionLabel> : null}
      {v.green_flags.map((f, i) => (
        <Bullet key={i} mark={"✓"} color={c.tone.good}>
          {f}
        </Bullet>
      ))}
    </View>
  );
}

function ProductCard({ report }: { report: Report }) {
  const c = useColors();
  const p = report.product!;
  const [rating, tone] = label(PRODUCT, p.rating);
  return (
    <View>
      <Text style={[styles.cardHeadline, { color: c.text }]}>{p.name || "The product"}</Text>
      <View style={[styles.scoreHead, { marginTop: 8 }]}>
        <Badge text={rating} tone={tone} />
        <Text style={[styles.scoreValue, { color: c.tone[scoreTone(p.score)] }]}>{p.score}</Text>
      </View>
      <ScoreBar score={p.score} tone={scoreTone(p.score)} />
      <Body style={{ marginTop: 12 }}>{p.summary}</Body>
      {p.pros.length ? <SectionLabel>Pros</SectionLabel> : null}
      {p.pros.map((x, i) => (
        <Bullet key={i} mark="+" color={c.tone.good}>
          {x}
        </Bullet>
      ))}
      {p.cons.length ? <SectionLabel>Cons</SectionLabel> : null}
      {p.cons.map((x, i) => (
        <Bullet key={i} mark={"−"} color={c.tone.warn}>
          {x}
        </Bullet>
      ))}
    </View>
  );
}

function MediaCard({ report }: { report: Report }) {
  const c = useColors();
  return (
    <View style={{ gap: 18 }}>
      {report.media!.items.map((m, i) => {
        const [rating, tone] = label(MEDIA, m.rating);
        const st = scoreTone(m.authenticity_score);
        return (
          <View key={i}>
            <Text style={[styles.cardHeadline, { color: c.text }]}>{m.label || m.ref}</Text>
            <View style={[styles.scoreHead, { marginTop: 6 }]}>
              <Badge text={rating} tone={tone} />
              <Text style={[styles.scoreValue, { color: c.tone[st] }]}>{m.authenticity_score}</Text>
            </View>
            <ScoreBar score={m.authenticity_score} tone={st} />
            <View style={styles.likelihoods}>
              <Text style={[styles.small, { color: c.text2 }]}>AI-generated: {LIKELIHOOD[m.ai_generated_likelihood] ?? m.ai_generated_likelihood}</Text>
              <Text style={[styles.small, { color: c.text2 }]}>Edited: {LIKELIHOOD[m.manipulation_likelihood] ?? m.manipulation_likelihood}</Text>
            </View>
            {m.findings.map((f, k) => (
              <Bullet key={k} mark={"●"} color={f.signal === "authentic" ? c.tone.good : f.signal === "suspicious" ? c.tone.bad : c.tone.neutral}>
                {f.observation}
              </Bullet>
            ))}
            {m.provenance ? (
              <>
                <SectionLabel>Where it came from</SectionLabel>
                <Body>{m.provenance}</Body>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function NextCard({ record, client, onDisputed }: { record: AnalysisRecord; client: Client | null; onDisputed(): void }) {
  const c = useColors();
  const r = record.report;
  const [sent, setSent] = useState(Boolean(record.disputed));
  const send = async (note: string) => {
    if (!client) return;
    try {
      await client.dispute(record.id, note);
      setSent(true);
      onDisputed();
    } catch (err) {
      Alert.alert("Couldn't send", (err as Error).message);
    }
  };
  const dispute = () => {
    const title = "What looks wrong?";
    const message = "troonooz won't reuse this result for other checks, and will warn when its findings come up again.";
    if (Platform.OS === "ios") Alert.prompt(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Send", onPress: (note?: string) => void send(note ?? "") }], "plain-text");
    else if (Platform.OS === "web") {
      const note = globalThis.prompt?.(`${title}\n${message}`);
      if (note !== null && note !== undefined) void send(note);
    } else void send("");
  };
  return (
    <View>
      {r.recommendations.map((x, i) => (
        <Bullet key={i} mark={`${i + 1}.`} color={c.accent}>
          {x}
        </Bullet>
      ))}
      {r.limitations.length ? <SectionLabel>What couldn't be checked</SectionLabel> : null}
      {r.limitations.map((x, i) => (
        <Bullet key={i}>{x}</Bullet>
      ))}
      <SectionLabel>Think this is wrong?</SectionLabel>
      {sent ? <Body muted>Thanks. This result is marked as disputed and won't be reused.</Body> : <Button title="Report a problem" kind="secondary" onPress={dispute} />}
    </View>
  );
}

function SourcesCard({ report }: { report: Report }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      {report.sources.map((s, i) => (
        <Pressable
          key={i}
          onPress={() => openLink(s.url)}
          accessibilityRole="link"
          accessibilityLabel={`${s.title || hostOf(s.url)}, ${hostOf(s.url)}. ${s.supports}`}
          style={({ pressed }) => [styles.source, { backgroundColor: c.surface2, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.sourceTitle, { color: c.accent }]} numberOfLines={2}>
            {s.title || hostOf(s.url)}
          </Text>
          <Text style={[styles.small, { color: c.text3 }]}>{hostOf(s.url)}</Text>
          <Body muted style={{ marginTop: 4 }}>
            {s.supports}
          </Body>
          {s.seen === false ? <Text style={[styles.small, { color: c.tone.caution, marginTop: 4 }]}>Not found in this check's research: treat with care.</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function RelatedCard({ record }: { record: AnalysisRecord }) {
  const c = useColors();
  const members = (record.story?.members ?? []).filter((m) => m.id !== record.id);
  return (
    <View style={{ gap: 10 }}>
      {record.story?.title ? <Body muted>Other checks of the same story: {record.story.title}</Body> : null}
      {members.map((m) => {
        const tone = scoreTone(m.trust_score, m.rating);
        return (
          <Pressable
            key={m.id}
            onPress={() => router.push({ pathname: "/report/[id]", params: { id: m.id } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.source, styles.related, { backgroundColor: c.surface2, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.sourceTitle, { color: c.text }]}>{m.headline}</Text>
              <Text style={[styles.small, { color: c.text3 }]}>{timeAgo(m.created_at)}</Text>
            </View>
            <Text style={[styles.scoreValue, { color: c.tone[tone] }]}>{scoreText(m.trust_score, m.rating)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { borderRadius: 18, padding: 18, gap: 10, backfaceVisibility: "hidden" },
  rear: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, gap: 4 },
  faceLabel: { fontSize: 13, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  bigScore: { fontSize: 76, fontWeight: "800", letterSpacing: -2, lineHeight: 84, fontVariant: ["tabular-nums"] },
  outOf: { fontSize: 24, fontWeight: "600", letterSpacing: 0 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  headline: { fontSize: 21, fontWeight: "800", lineHeight: 27 },
  hint: { fontSize: 13, marginTop: 4 },
  meta: { fontSize: 13, marginTop: 14 },
  flagRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  sevDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  small: { fontSize: 13, lineHeight: 18 },
  scoreRow: { borderRadius: 14, padding: 14, gap: 8 },
  scoreHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  scoreLabel: { fontSize: 16, fontWeight: "600" },
  scoreValue: { fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  scoreFoot: { flexDirection: "row", justifyContent: "space-between" },
  thumb: { width: "100%", height: 180, borderRadius: 12, marginBottom: 12 },
  lead: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
  claim: { borderLeftWidth: 3, paddingLeft: 12, marginTop: 16, gap: 6 },
  claimText: { fontSize: 16, lineHeight: 22, fontStyle: "italic" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cardHeadline: { fontSize: 19, fontWeight: "700" },
  link: { fontSize: 15, marginTop: 2 },
  likelihoods: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, marginBottom: 8 },
  source: { borderRadius: 12, padding: 12 },
  sourceTitle: { fontSize: 16, fontWeight: "600" },
  related: { flexDirection: "row", alignItems: "center", gap: 10 },
});
