import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { Tone } from "../lib/labels";
import { useColors } from "../lib/theme";

export function Badge({ text, tone, plain }: { text: string; tone: Tone; plain?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.badge, { backgroundColor: plain ? c.surface : c.toneSoft[tone] }]}>
      <Text style={[styles.badgeText, { color: c.tone[tone] }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** A horizontal 0-100 bar with the score's tone. */
export function ScoreBar({ score, tone, height = 8 }: { score: number; tone: Tone; height?: number }) {
  const c = useColors();
  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: c.surface2 }]} accessible={false}>
      <View style={{ width: `${Math.max(2, Math.min(100, score))}%`, height, borderRadius: height / 2, backgroundColor: c.tone[tone] }} />
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[styles.sectionLabel, { color: c.text3 }]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[styles.body, { color: muted ? c.text2 : c.text }, style]}>{children}</Text>;
}

export function Bullet({ children, color, mark = "•" }: { children: ReactNode; color?: string; mark?: string }) {
  const c = useColors();
  return (
    <View style={styles.bullet}>
      <Text style={[styles.bulletMark, { color: color ?? c.text3 }]}>{mark}</Text>
      <Text style={[styles.body, styles.bulletText, { color: c.text }]}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "plain";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "secondary" ? c.surface2 : "transparent";
  const fg = kind === "primary" ? c.onAccent : c.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>;
}

/** A two-or-more option switch, e.g. Cards | 3D map. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surface2 }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }]}
          >
            <Text style={[styles.segmentText, { color: on ? c.text : c.text2 }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, maxWidth: "100%" },
  badgeText: { fontSize: 13, fontWeight: "600" },
  track: { width: "100%", overflow: "hidden" },
  sectionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
  body: { fontSize: 16, lineHeight: 22 },
  bullet: { flexDirection: "row", gap: 8, marginBottom: 6 },
  bulletMark: { fontSize: 16, lineHeight: 22, width: 16, textAlign: "center" },
  bulletText: { flex: 1 },
  button: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 17, fontWeight: "600" },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  segmented: { flexDirection: "row", borderRadius: 10, padding: 3 },
  segment: { flex: 1, minHeight: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 15, fontWeight: "600" },
});
