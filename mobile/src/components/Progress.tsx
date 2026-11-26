import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { Badge, Body, Button, Card } from "./ui";
import { OVERALL, label, scoreText, scoreTone, timeAgo } from "../lib/labels";
import { stepsFrom } from "../lib/progress";
import { useColors } from "../lib/theme";
import type { JobEvent, MatchInfo, ReportDraft } from "../lib/types";

/** A slowly turning cube of cards while the check runs: a hint of the 3D report to come. */
function Spinner({ reduceMotion }: { reduceMotion: boolean }) {
  const c = useColors();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn, reduceMotion]);
  if (reduceMotion) return <ActivityIndicator color={c.accent} />;
  const rotateY = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={styles.spinBox} accessibilityLabel="Working">
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            styles.spinCard,
            { backgroundColor: [c.tone.good, c.accent, c.tone.caution][i], transform: [{ perspective: 400 }, { rotateY }, { translateX: (i - 1) * 9 }, { rotate: `${(i - 1) * 10}deg` }] },
          ]}
        />
      ))}
    </View>
  );
}

export function ProgressView({ events, draft, startedAt, reconnecting, reduceMotion }: { events: JobEvent[]; draft: ReportDraft | null; startedAt: number; reconnecting: boolean; reduceMotion: boolean }) {
  const c = useColors();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const steps = stepsFrom(events).slice(-7);
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const tone = draft?.trust_score != null ? scoreTone(draft.trust_score, draft.rating ?? undefined) : "neutral";
  return (
    <View style={styles.page}>
      <Card>
        <View style={styles.head}>
          <Spinner reduceMotion={reduceMotion} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
              {draft?.headline ? "Writing the verdict…" : "Checking…"}
            </Text>
            <Text style={{ color: c.text3, fontSize: 14 }} accessibilityLiveRegion="polite">
              {elapsed}s elapsed{reconnecting ? " · reconnecting…" : ""}
            </Text>
          </View>
        </View>
        <View style={styles.steps} accessibilityLiveRegion="polite">
          {steps.map((s, i) => (
            <View key={`${i}-${s.text}`} style={[styles.step, { opacity: i === steps.length - 1 ? 1 : 0.6 }]}>
              <Text style={styles.stepIcon}>{s.icon}</Text>
              <Text style={[styles.stepText, { color: c.text2 }]} numberOfLines={2}>
                {s.text}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      {draft && (draft.headline || draft.summary) ? (
        <Card style={[styles.draft, { borderColor: c.tone[tone] }]}>
          <Text style={[styles.draftLabel, { color: c.text3 }]}>Early verdict (still being written)</Text>
          <View style={styles.draftRow}>
            {draft.rating ? <Badge text={label(OVERALL, draft.rating)[0]} tone={tone} /> : null}
            {draft.trust_score != null ? <Text style={[styles.draftScore, { color: c.tone[tone] }]}>{scoreText(draft.trust_score, draft.rating ?? undefined)}</Text> : null}
          </View>
          {draft.headline ? <Text style={[styles.draftHeadline, { color: c.text }]}>{draft.headline}</Text> : null}
          {draft.summary ? <Body muted>{draft.summary}</Body> : null}
        </Card>
      ) : null}
    </View>
  );
}

const MATCH_WORDS: Record<string, string> = { image: "image", video: "video", url: "link", text: "text", story: "story" };

export function MatchView({ match, onOpen, onFresh, busy }: { match: MatchInfo; onOpen(): void; onFresh(): void; busy: boolean }) {
  const c = useColors();
  const tone = scoreTone(match.trust_score, match.rating);
  const on = match.matched_on.map((m) => MATCH_WORDS[m] ?? m).join(", ");
  return (
    <View style={styles.page}>
      <Card>
        <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
          {match.story ? "Same story as an earlier check" : "Checked before"}
        </Text>
        <Body muted style={{ marginTop: 4 }}>
          {match.story
            ? `This looks like the same story as ${match.story.checks} earlier check${match.story.checks === 1 ? "" : "s"}: ${match.story.reason}`
            : `troonooz already checked this ${on || "content"} ${timeAgo(match.created_at)}, so you get the answer instantly at no cost.`}
        </Body>
        <View style={[styles.matchRow, { backgroundColor: c.surface2 }]}>
          {match.thumbnail ? <Image source={{ uri: match.thumbnail }} style={styles.matchThumb} /> : null}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[styles.draftHeadline, { color: c.text }]}>{match.headline}</Text>
            <Badge text={label(OVERALL, match.rating)[0]} tone={tone} />
          </View>
          <Text style={[styles.draftScore, { color: c.tone[tone] }]}>{scoreText(match.trust_score, match.rating)}</Text>
        </View>
        <Button title="See that check" onPress={onOpen} />
        <Button title="Run a fresh check instead" kind="plain" onPress={onFresh} busy={busy} style={{ marginTop: 4 }} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  title: { fontSize: 22, fontWeight: "800" },
  steps: { marginTop: 14, gap: 8 },
  step: { flexDirection: "row", gap: 10 },
  stepIcon: { width: 22, textAlign: "center", fontSize: 15 },
  stepText: { flex: 1, fontSize: 15, lineHeight: 20 },
  draft: { borderWidth: 2, gap: 8 },
  draftLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  draftRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  draftScore: { fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  draftHeadline: { fontSize: 18, fontWeight: "700", lineHeight: 24 },
  matchRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, marginVertical: 14 },
  matchThumb: { width: 60, height: 60, borderRadius: 10 },
  spinBox: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  spinCard: { position: "absolute", width: 24, height: 32, borderRadius: 5, opacity: 0.9 },
});
