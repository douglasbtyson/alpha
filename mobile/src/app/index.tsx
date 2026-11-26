import * as ImagePicker from "expo-image-picker";
import { Link, Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Badge, Body, Button, Card, Segmented } from "../components/ui";
import { ApiError, type CheckMode } from "../lib/api";
import { CONTENT_TYPES, OVERALL, label, scoreText, scoreTone, timeAgo } from "../lib/labels";
import { useSettings } from "../lib/settings";
import { useColors } from "../lib/theme";
import type { RecordSummary } from "../lib/types";

export default function Home() {
  const c = useColors();
  const { ready, server, client, mode, setMode } = useSettings();
  const [reports, setReports] = useState<RecordSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setReports(await client.reports());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const pick = async () => {
    if (!client) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: false });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    setUploading(true);
    setError(null);
    try {
      const type = asset.mimeType ?? "image/jpeg";
      const ext = type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      const job = await client.check({ uri: asset.uri, name: asset.fileName ?? `photo.${ext}`, type }, mode);
      router.push({ pathname: "/report/[id]", params: { id: job.id } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the image. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const header = (
    <View style={styles.head}>
      <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
        Can you trust it?
      </Text>
      <Body muted>Double-tap the back of your iPhone in any app to check what's on screen, or pick a screenshot or photo here.</Body>
      {ready && !server ? (
        <Card style={styles.gap}>
          <Text style={[styles.cardTitle, { color: c.text }]}>Connect to your troonooz server</Text>
          <Body muted>
            On your computer, open troonooz and go to the Phone page. Follow its steps, then run the shortcut once: the app connects itself. Or enter your server's address yourself.
          </Body>
          <Button title="Enter server address" onPress={() => router.push("/settings")} style={styles.gapSmall} />
        </Card>
      ) : null}
      {server ? (
        <Card style={styles.gap}>
          <Segmented<CheckMode>
            label="How thorough"
            value={mode}
            onChange={setMode}
            options={[
              { value: "quick", label: "Quick" },
              { value: "thorough", label: "Thorough" },
            ]}
          />
          <Body muted style={styles.hint}>
            {mode === "quick" ? "A lighter model and a few searches: usually under a minute." : "Verifies the key claims with several searches: usually 1–2 minutes."}
          </Body>
          <Button title="Check a screenshot or photo" onPress={pick} busy={uploading} />
        </Card>
      ) : null}
      {error ? (
        <Text style={[styles.error, { color: c.tone.bad }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {reports?.length ? (
        <Text style={[styles.listTitle, { color: c.text }]} accessibilityRole="header">
          Recent checks
        </Text>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={12}>
                <Text style={{ color: c.accent, fontSize: 17 }}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        data={reports ?? []}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={server ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined}
        ListEmptyComponent={server && reports ? <Body muted>No checks yet.</Body> : undefined}
        renderItem={({ item }) => <ReportRow item={item} />}
      />
    </>
  );
}

function ReportRow({ item }: { item: RecordSummary }) {
  const c = useColors();
  const tone = scoreTone(item.trust_score, item.rating);
  const [ratingLabel] = label(OVERALL, item.rating);
  const kind = [CONTENT_TYPES[item.content_type], item.platform].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.headline}. ${ratingLabel}${item.rating === "nothing_to_check" ? "" : `, trust score ${item.trust_score}`}. ${timeAgo(item.created_at)}`}
      onPress={() => router.push({ pathname: "/report/[id]", params: { id: item.id } })}
      style={({ pressed }) => [styles.row, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
    >
      {item.thumbnail ? <Image source={{ uri: item.thumbnail }} style={[styles.thumb, { backgroundColor: c.surface2 }]} /> : <View style={[styles.thumb, { backgroundColor: c.surface2 }]} />}
      <View style={styles.rowText}>
        <Text style={[styles.rowHeadline, { color: c.text }]} numberOfLines={2}>
          {item.headline}
        </Text>
        <Text style={[styles.rowMeta, { color: c.text3 }]} numberOfLines={1}>
          {[kind, timeAgo(item.created_at), item.disputed ? "Disputed" : ""].filter(Boolean).join(" · ")}
        </Text>
        <Badge text={ratingLabel} tone={tone} />
      </View>
      <View style={[styles.pill, { backgroundColor: c.toneSoft[tone] }]}>
        <Text style={[styles.pillText, { color: c.tone[tone] }]}>{scoreText(item.trust_score, item.rating)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  head: { gap: 8, marginBottom: 4 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  cardTitle: { fontSize: 18, fontWeight: "700", marginBottom: 6 },
  gap: { marginTop: 8, gap: 10 },
  gapSmall: { marginTop: 8 },
  hint: { fontSize: 14 },
  error: { fontSize: 15, marginTop: 6 },
  listTitle: { fontSize: 20, fontWeight: "700", marginTop: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  rowText: { flex: 1, gap: 4 },
  rowHeadline: { fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 13 },
  pill: { minWidth: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  pillText: { fontSize: 17, fontWeight: "800" },
});
