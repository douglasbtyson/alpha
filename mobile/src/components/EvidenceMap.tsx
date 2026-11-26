import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { childrenOf, neighbours, type Graph, type GraphNode } from "../lib/graph";
import { clampPitch, hitTest, project, rotate, type Vec3, type Viewport } from "../lib/projection";
import { MAP_TONE, useColors } from "../lib/theme";

const DRAG = 0.008; // radians per pixel dragged
const START = { yaw: -0.45, pitch: -0.42 };
const AUTO_SPIN = 0.00022; // radians per millisecond
const AUTO_SPIN_FOR = 14_000;
const RADIUS = { post: 30, hub: 18, leaf: 10 };
const LABEL_W = 160;
/** How far round from dead centre a chosen dot settles, so it doesn't hide the post behind it. */
const FOCUS_OFFSET = 0.85;

/** A few hundred "stars" far behind the evidence give the scene depth as it turns. */
function stars(count: number): Vec3[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: count }, () => {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = 4.2 + rand() * 1.4;
    const s = Math.sqrt(1 - u * u);
    return { x: r * s * Math.cos(a), y: r * u, z: r * s * Math.sin(a) };
  });
}
const STARS = stars(70);

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

interface Props {
  graph: Graph;
  reduceMotion: boolean;
  onOpenUrl(url: string): void;
  onOpenReport(id: string): void;
}

/**
 * The evidence map: the post sits in the middle, each part of the check is a hub around it, and the
 * findings orbit their hubs. Drag to spin it in 3D, tap any dot to fly to it and read it.
 */
export function EvidenceMap({ graph, reduceMotion, onOpenUrl, onOpenReport }: Props) {
  const c = useColors();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [selected, setSelected] = useState<string | null>(null);
  const cam = useRef({
    yaw: START.yaw,
    pitch: START.pitch,
    vyaw: 0,
    vpitch: 0,
    auto: !reduceMotion,
    autoUntil: Date.now() + AUTO_SPIN_FOR,
    dragging: false,
    target: null as { yaw: number; pitch: number } | null,
  });
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const placed = useRef<{ id: string; x: number; y: number; r: number; depth: number }[]>([]);

  // With a dot chosen, the scene moves up to make room for its details below.
  const view: Viewport = useMemo(
    () => ({ width: size.width, height: size.height, extent: 2.15, distance: 8, centerY: selected ? 0.4 : 0.5 }),
    [size, selected],
  );
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const lit = useMemo(() => (selected ? neighbours(graph, selected) : null), [graph, selected]);

  const step = useCallback(
    (t: number) => {
      const s = cam.current;
      const dt = Math.min(48, last.current ? t - last.current : 16);
      last.current = t;
      let moving = false;
      if (!s.dragging) {
        if (s.target) {
          const k = 1 - Math.exp(-dt / 160);
          const dy = angleDiff(s.yaw, s.target.yaw);
          const dp = s.target.pitch - s.pitch;
          s.yaw += dy * k;
          s.pitch += dp * k;
          if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) s.target = null;
          moving = true;
        } else if (Math.abs(s.vyaw) > 1e-5 || Math.abs(s.vpitch) > 1e-5) {
          s.yaw += s.vyaw * dt;
          s.pitch = clampPitch(s.pitch + s.vpitch * dt);
          const friction = Math.exp(-dt / 420);
          s.vyaw *= friction;
          s.vpitch *= friction;
          moving = true;
        } else if (s.auto && Date.now() < s.autoUntil) {
          s.yaw += AUTO_SPIN * dt;
          moving = true;
        }
      }
      if (moving) {
        redraw();
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = null;
        last.current = 0;
      }
    },
    [],
  );

  const kick = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(step);
  }, [step]);

  useEffect(() => {
    if (!reduceMotion) kick();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [kick, reduceMotion]);

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      const s = cam.current;
      s.auto = false;
      if (!id) return;
      if (Platform.OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const node = byId.get(id);
      if (!node || node.kind === "post") return;
      // Turn the scene so the chosen dot comes round to the front, just off to the side of the post.
      const p = node.pos;
      const target = { yaw: Math.atan2(-p.x, p.z) + FOCUS_OFFSET, pitch: clampPitch(Math.atan2(p.y, Math.hypot(p.x, p.z)) * 0.6 - 0.2) };
      s.vyaw = s.vpitch = 0;
      if (reduceMotion) {
        s.yaw = target.yaw;
        s.pitch = target.pitch;
        redraw();
      } else {
        s.target = target;
        kick();
      }
    },
    [byId, kick, reduceMotion],
  );

  const gesture = useRef({ yaw: 0, pitch: 0, x: 0, y: 0 });
  const selectRef = useRef(select);
  selectRef.current = select;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const s = cam.current;
          s.dragging = true;
          s.auto = false;
          s.target = null;
          s.vyaw = s.vpitch = 0;
          gesture.current = { yaw: s.yaw, pitch: s.pitch, x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        },
        onPanResponderMove: (_e, g) => {
          const s = cam.current;
          s.yaw = gesture.current.yaw + g.dx * DRAG;
          s.pitch = clampPitch(gesture.current.pitch + g.dy * DRAG);
          redraw();
        },
        onPanResponderRelease: (_e, g) => {
          const s = cam.current;
          s.dragging = false;
          if (Math.hypot(g.dx, g.dy) < 8) {
            const hit = hitTest(placed.current, gesture.current.x + g.dx, gesture.current.y + g.dy, 16);
            selectRef.current(hit ? hit.id : null);
            return;
          }
          if (!reduceMotion) {
            s.vyaw = g.vx * DRAG;
            s.vpitch = g.vy * DRAG * 0.6;
            kick();
          }
        },
        onPanResponderTerminate: () => {
          cam.current.dragging = false;
        },
      }),
    [kick, reduceMotion],
  );

  const reset = () => {
    const s = cam.current;
    setSelected(null);
    s.vyaw = s.vpitch = 0;
    if (reduceMotion) {
      s.yaw = START.yaw;
      s.pitch = START.pitch;
      redraw();
    } else {
      s.target = { ...START };
      s.auto = true;
      s.autoUntil = Date.now() + AUTO_SPIN_FOR;
      kick();
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  // ---- Project the scene for this frame ----
  const { yaw, pitch } = cam.current;
  const ready = size.width > 0 && size.height > 0;
  const projected = new Map<string, ReturnType<typeof project> & { node: GraphNode; r: number }>();
  if (ready) {
    for (const node of graph.nodes) {
      const p = project(rotate(node.pos, yaw, pitch), view);
      projected.set(node.id, { ...p, node, r: RADIUS[node.kind] * p.scale });
    }
  }
  const order = [...projected.values()].sort((a, b) => a.depth - b.depth);
  placed.current = order.map((p) => ({ id: p.node.id, x: p.x, y: p.y, r: p.r, depth: p.depth }));
  const sel = selected ? byId.get(selected) : undefined;

  return (
    <View style={[styles.wrap, { backgroundColor: c.space, borderColor: c.border }]}>
      <View style={StyleSheet.absoluteFill} onLayout={onLayout} {...pan.panHandlers} accessible accessibilityLabel="3D evidence map. Drag to spin it, tap a dot to read it. The card deck shows the same findings as a list.">
        {ready
          ? STARS.map((s, i) => {
              const p = project(rotate(s, yaw * 0.6, pitch * 0.6), { ...view, distance: 12 });
              const d = 1 + p.depth * 1.6;
              return <View key={`s${i}`} pointerEvents="none" style={[styles.star, { left: p.x - d / 2, top: p.y - d / 2, width: d, height: d, opacity: 0.25 + p.depth * 0.55 }]} />;
            })
          : null}
        {ready
          ? graph.edges.map((e, i) => {
              const a = projected.get(e.from);
              const b = projected.get(e.to);
              if (!a || !b) return null;
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              const on = lit ? lit.has(e.from) && lit.has(e.to) : false;
              const depth = (a.depth + b.depth) / 2;
              const color = on ? MAP_TONE[(byId.get(e.to)?.tone ?? "neutral")] : e.cross ? "#7dd3fc" : "#cbd5e1";
              const opacity = lit && !on ? 0.06 : (e.cross ? 0.25 : 0.18) + depth * (on ? 0.7 : 0.35);
              return (
                <View
                  key={`e${i}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: (a.x + b.x) / 2 - len / 2,
                    top: (a.y + b.y) / 2 - 0.75,
                    width: len,
                    height: on ? 2 : 1.5,
                    backgroundColor: color,
                    opacity,
                    transform: [{ rotate: `${Math.atan2(b.y - a.y, b.x - a.x)}rad` }],
                  }}
                />
              );
            })
          : null}
        {order.map(({ node, x, y, r, depth, scale }) => {
          const color = MAP_TONE[node.tone];
          const dim = lit ? !lit.has(node.id) : false;
          const isSel = node.id === selected;
          // The post's verdict is in the title bar; hubs are labelled unless they're far round the back.
          const showLabel = node.kind === "hub" ? depth > 0.3 || isSel || (lit?.has(node.id) ?? false) : node.kind === "leaf" && (isSel || (lit?.has(node.id) ?? false));
          const opacity = dim ? 0.22 : 0.45 + depth * 0.55;
          return (
            <View key={node.id} pointerEvents="none" style={[styles.nodeWrap, { opacity }]}>
              <View
                style={[
                  styles.ball,
                  {
                    left: x - r,
                    top: y - r,
                    width: r * 2,
                    height: r * 2,
                    borderRadius: r,
                    backgroundColor: color,
                    borderWidth: isSel ? 3 : node.kind === "post" ? 2 : 0,
                    borderColor: "#ffffff",
                    shadowColor: color,
                    shadowOpacity: node.kind === "leaf" ? 0.4 : 0.8,
                    shadowRadius: node.kind === "post" ? 18 : 8,
                  },
                ]}
              >
                <View style={[styles.shine, { width: r * 0.9, height: r * 0.9, borderRadius: r, top: r * 0.22, left: r * 0.3 }]} />
                {node.kind === "post" ? <Text style={[styles.postValue, { fontSize: Math.max(14, 22 * scale) }]}>{node.value}</Text> : null}
                {node.kind === "hub" && node.icon ? <Text style={{ fontSize: Math.max(10, 15 * scale) }}>{node.icon}</Text> : null}
              </View>
              {showLabel ? (
                // Labels stay on screen even when their dot is near the edge.
                <View style={[styles.labelBox, { top: y + r + 4, left: Math.max(4, Math.min(size.width - LABEL_W - 4, x - LABEL_W / 2)) }]}>
                  <View style={styles.labelInner}>
                    <Text style={[styles.label, { fontSize: node.kind === "leaf" ? 11 : 12.5 }]} numberOfLines={node.kind === "leaf" ? 2 : 1}>
                      {node.title}
                    </Text>
                    {node.kind === "hub" && node.badge ? (
                      <Text style={[styles.labelSub, { color }]} numberOfLines={1}>
                        {node.badge}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.hint} pointerEvents="none">
          Drag to spin {"·"} tap a dot
        </Text>
        <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel="Reset the map" style={styles.reset} hitSlop={8}>
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>

      {sel ? (
        <NodeSheet node={sel} items={sel.kind === "hub" ? childrenOf(graph, sel.id) : []} onSelect={select} onClose={() => select(null)} onOpenUrl={onOpenUrl} onOpenReport={onOpenReport} />
      ) : (
        <View style={styles.legend} pointerEvents="none">
          {(
            [
              ["good", "Reassuring"],
              ["caution", "Mixed"],
              ["bad", "Concerning"],
              ["neutral", "Unclear / info"],
            ] as const
          ).map(([tone, text]) => (
            <View key={tone} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: MAP_TONE[tone] }]} />
              <Text style={styles.legendText}>{text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function NodeSheet({
  node,
  items,
  onSelect,
  onClose,
  onOpenUrl,
  onOpenReport,
}: {
  node: GraphNode;
  /** For a hub, the findings around it. */
  items: GraphNode[];
  onSelect(id: string): void;
  onClose(): void;
  onOpenUrl(url: string): void;
  onOpenReport(id: string): void;
}) {
  const c = useColors();
  const color = c.tone[node.tone];
  // Short findings (a flag, a pro) are their own detail: show the full text once, as the title.
  const same = Boolean(node.detail) && node.detail.startsWith(node.title.replace(/\u2026$/, ""));
  const title = same ? node.detail : node.title;
  const detail = same ? "" : node.detail;
  return (
    <View style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityViewIsModal={false}>
      <View style={styles.sheetHead}>
        <View style={[styles.legendDot, { backgroundColor: color, width: 12, height: 12, borderRadius: 6 }]} />
        <Text style={[styles.sheetTitle, { color: c.text }]} accessibilityRole="header">
          {node.icon ? `${node.icon} ` : ""}
          {title}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} style={styles.close}>
          <Text style={{ color: c.text3, fontSize: 22, lineHeight: 24 }}>{"×"}</Text>
        </Pressable>
      </View>
      {node.badge ? (
        <View style={[styles.sheetBadge, { backgroundColor: c.toneSoft[node.tone] }]}>
          <Text style={{ color, fontWeight: "700", fontSize: 13 }}>{node.kind === "post" ? `${node.badge} · ${node.value}` : node.badge}</Text>
        </View>
      ) : null}
      <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled>
        {detail ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{detail}</Text> : null}
        {items.map((it) => (
          <Pressable
            key={it.id}
            onPress={() => onSelect(it.id)}
            accessibilityRole="button"
            accessibilityLabel={`${it.title}${it.badge ? `, ${it.badge}` : ""}`}
            style={({ pressed }) => [styles.item, { backgroundColor: c.surface2, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.legendDot, { backgroundColor: c.tone[it.tone], marginTop: 6 }]} />
            <Text style={{ flex: 1, color: c.text, fontSize: 15, lineHeight: 20 }} numberOfLines={2}>
              {it.title}
            </Text>
            {it.badge ? <Text style={{ color: c.tone[it.tone], fontSize: 13, fontWeight: "700", marginTop: 2 }}>{it.badge}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
      {node.url ? (
        <Pressable onPress={() => onOpenUrl(node.url!)} accessibilityRole="link" style={[styles.sheetButton, { backgroundColor: c.accent }]}>
          <Text style={{ color: c.onAccent, fontWeight: "700", fontSize: 15 }}>Open {node.kind === "hub" ? "website" : "source"}</Text>
        </Pressable>
      ) : null}
      {node.reportId ? (
        <Pressable onPress={() => onOpenReport(node.reportId!)} accessibilityRole="button" style={[styles.sheetButton, { backgroundColor: c.accent }]}>
          <Text style={{ color: c.onAccent, fontWeight: "700", fontSize: 15 }}>Open this check</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: "hidden", borderRadius: 22, marginHorizontal: 12, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth },
  star: { position: "absolute", borderRadius: 2, backgroundColor: "#ffffff" },
  nodeWrap: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  ball: { position: "absolute", alignItems: "center", justifyContent: "center", overflow: "visible", shadowOffset: { width: 0, height: 0 } },
  shine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.32)" },
  postValue: { color: "#0b1220", fontWeight: "900" },
  labelBox: { position: "absolute", width: LABEL_W, alignItems: "center" },
  labelInner: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(7,11,18,0.72)", maxWidth: LABEL_W, alignItems: "center" },
  label: { color: "#e8ecf2", fontWeight: "600", textAlign: "center" },
  labelSub: { fontSize: 11, fontWeight: "700" },
  topBar: { position: "absolute", top: 10, left: 12, right: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  hint: { color: "rgba(232,236,242,0.7)", fontSize: 13 },
  reset: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.12)" },
  resetText: { color: "#e8ecf2", fontWeight: "600", fontSize: 14 },
  legend: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { color: "rgba(232,236,242,0.8)", fontSize: 12 },
  sheet: { position: "absolute", left: 10, right: 10, bottom: 10, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: "700" },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  sheetBadge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  item: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 10, marginTop: 6 },
  sheetButton: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
});
