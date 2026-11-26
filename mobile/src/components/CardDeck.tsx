import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewInstance } from "react-native";
import type { Tone } from "../lib/labels";
import { useColors } from "../lib/theme";

export interface DeckApi {
  /** Swing the deck to another card, e.g. from a score to its details. */
  goTo(key: string): void;
}

export interface DeckCard {
  key: string;
  title: string;
  icon: string;
  tone?: Tone;
  render(api: DeckApi): ReactNode;
}

/**
 * The report as a 3D carousel: the card in front faces you, its neighbours turn away on either
 * side, and swiping swings the next one round. With Reduce Motion on, cards just slide.
 */
export function CardDeck({ cards, reduceMotion }: { cards: DeckCard[]; reduceMotion: boolean }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const item = Math.round(Math.min(width * 0.76, 500));
  const side = Math.round((width - item) / 2);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scroller = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const id = scrollX.addListener(({ value }) => {
      const i = Math.max(0, Math.min(cards.length - 1, Math.round(value / item)));
      if (i === current.current) return;
      current.current = i;
      setIndex(i);
      if (Platform.OS === "ios") void Haptics.selectionAsync().catch(() => {});
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, item, cards.length]);

  const go = (i: number) => {
    const target = Math.max(0, Math.min(cards.length - 1, i));
    scroller.current?.scrollTo({ x: target * item, animated: !reduceMotion });
  };
  const api = useMemo<DeckApi>(() => ({ goTo: (key) => go(cards.findIndex((k) => k.key === key)) }), [cards, item, reduceMotion]);

  return (
    <View style={styles.wrap}>
      <Animated.ScrollView
        ref={scroller as never}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={item}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: side }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: Platform.OS !== "web" })}
        scrollEventThrottle={16}
        style={styles.wrap}
        accessibilityLabel="Report cards. Swipe left or right to move between them."
      >
        {cards.map((card, i) => {
          const inputRange = [(i - 1) * item, i * item, (i + 1) * item];
          const opacity = scrollX.interpolate({ inputRange, outputRange: [0.55, 1, 0.55], extrapolate: "clamp" });
          const transform = reduceMotion
            ? []
            : [
                { perspective: 1000 },
                { translateX: scrollX.interpolate({ inputRange, outputRange: [-item * 0.1, 0, item * 0.1], extrapolate: "clamp" }) },
                { rotateY: scrollX.interpolate({ inputRange, outputRange: ["-30deg", "0deg", "30deg"], extrapolate: "clamp" }) },
                { scale: scrollX.interpolate({ inputRange, outputRange: [0.88, 1, 0.88], extrapolate: "clamp" }) },
              ];
          const tone = card.tone ? c.tone[card.tone] : c.accent;
          return (
            <Animated.View key={card.key} style={[styles.slot, { width: item, opacity, transform }]} accessibilityElementsHidden={i !== index} importantForAccessibility={i === index ? "auto" : "no-hide-descendants"}>
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={[styles.cardHead, { borderBottomColor: c.border }]}>
                  <View style={[styles.cardDot, { backgroundColor: tone }]} />
                  <Text style={[styles.cardTitle, { color: c.text }]} accessibilityRole="header" numberOfLines={1}>
                    {card.icon} {card.title}
                  </Text>
                  <Text style={[styles.cardCount, { color: c.text3 }]}>
                    {i + 1}/{cards.length}
                  </Text>
                </View>
                <ScrollView nestedScrollEnabled contentContainerStyle={styles.cardBody} showsVerticalScrollIndicator={false}>
                  {card.render(api)}
                </ScrollView>
              </View>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>

      <View style={styles.pager}>
        <PagerButton label="Previous card" glyph={"‹"} disabled={index === 0} onPress={() => go(index - 1)} />
        <View style={styles.dots}>
          {cards.map((card, i) => (
            <Pressable
              key={card.key}
              accessibilityRole="button"
              accessibilityLabel={`Go to card ${i + 1}: ${card.title}`}
              accessibilityState={{ selected: i === index }}
              hitSlop={6}
              onPress={() => go(i)}
              style={[styles.dot, { backgroundColor: i === index ? (card.tone ? c.tone[card.tone] : c.accent) : c.borderStrong, width: i === index ? 22 : 8 }]}
            />
          ))}
        </View>
        <PagerButton label="Next card" glyph={"›"} disabled={index === cards.length - 1} onPress={() => go(index + 1)} />
      </View>
    </View>
  );
}

function PagerButton({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={[styles.pagerButton, { backgroundColor: c.surface, borderColor: c.border, opacity: disabled ? 0.35 : 1 }]}
    >
      <Text style={[styles.pagerGlyph, { color: c.accent }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  slot: { paddingVertical: 12, paddingHorizontal: 5 },
  card: {
    flex: 1,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  cardDot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
  cardCount: { fontSize: 13, fontVariant: ["tabular-nums"] },
  cardBody: { padding: 16, paddingBottom: 28 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 14, paddingTop: 2 },
  dots: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, flexWrap: "wrap", justifyContent: "center" },
  dot: { height: 8, borderRadius: 4 },
  pagerButton: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  pagerGlyph: { fontSize: 26, lineHeight: 28, fontWeight: "600" },
});
