import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { CardDeck } from "../../components/CardDeck";
import { EvidenceMap } from "../../components/EvidenceMap";
import { MatchView, ProgressView } from "../../components/Progress";
import { openLink, reportCards } from "../../components/ReportCards";
import { Body, Button, Card, Segmented } from "../../components/ui";
import { buildGraph } from "../../lib/graph";
import { OVERALL, hostOf, label } from "../../lib/labels";
import { incomingServer, normalizeServer } from "../../lib/server";
import { useSettings, type ReportView } from "../../lib/settings";
import { useColors } from "../../lib/theme";
import { useCheck } from "../../lib/useCheck";
import type { AnalysisRecord } from "../../lib/types";

export default function ReportScreen() {
  const c = useColors();
  const params = useLocalSearchParams<{ id: string; server?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const settings = useSettings();
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  // A link from the shortcut names the server that ran the check (troonooz://report/<id>?server=…).
  useEffect(() => {
    if (!settings.ready) return;
    const inc = incomingServer(params.server, settings.server);
    if (inc.action === "adopt" && inc.server) void settings.setServer(inc.server);
    else if (inc.action === "confirm") setSwitchTo(inc.server);
  }, [settings.ready, params.server]); // eslint-disable-line react-hooks/exhaustive-deps

  const waiting = !settings.ready || Boolean(switchTo);
  const { state, reload } = useCheck(waiting ? null : settings.client, id);

  if (switchTo) {
    return (
      <View style={styles.page}>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Switch troonooz server?</Text>
          <Body muted style={{ marginTop: 6 }}>
            This check ran on {hostOf(switchTo)}, but the app is set up for {settings.server ? hostOf(settings.server) : "another server"}. Only switch if {hostOf(switchTo)} is your own troonooz server.
          </Body>
          <Button
            title={`Switch to ${hostOf(switchTo)}`}
            style={{ marginTop: 14 }}
            onPress={async () => {
              await settings.setServer(switchTo);
              setSwitchTo(null);
            }}
          />
          <Button
            title="Keep my current server"
            kind="plain"
            onPress={() => {
              setSwitchTo(null);
              setDeclined(true);
            }}
          />
        </Card>
      </View>
    );
  }

  // While a server named by the link is being saved, keep showing the spinner below.
  if (settings.ready && !settings.server && !normalizeServer(params.server)) {
    return (
      <View style={styles.page}>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Connect to your troonooz server first</Text>
          <Button title="Open Settings" style={{ marginTop: 14 }} onPress={() => router.push("/settings")} />
        </Card>
      </View>
    );
  }

  switch (state.phase) {
    case "loading":
      return (
        <View style={[styles.page, styles.center]}>
          <ActivityIndicator color={c.accent} size="large" />
        </View>
      );
    case "running":
      return (
        <>
          <Stack.Screen options={{ title: "Checking…" }} />
          <ProgressView events={state.events} draft={state.draft} startedAt={state.startedAt} reconnecting={state.reconnecting} reduceMotion={settings.reduceMotion} />
        </>
      );
    case "matched":
      return <Matched id={id!} match={state.match} />;
    case "error":
      return (
        <View style={styles.page}>
          <Card>
            <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
              {state.code === "not_found" ? "Check not found" : "The check didn't finish"}
            </Text>
            <Body muted style={{ marginTop: 6 }}>
              {declined ? "This check is on a different troonooz server. " : ""}
              {state.message}
            </Body>
            <Button title="Try again" style={{ marginTop: 14 }} onPress={reload} />
          </Card>
        </View>
      );
    case "done":
      return <Done record={state.record} onChanged={reload} />;
  }
}

function Matched({ id, match }: { id: string; match: import("../../lib/types").MatchInfo }) {
  const { client } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = useColors();
  return (
    <>
      <MatchView
        match={match}
        busy={busy}
        onOpen={() => router.replace({ pathname: "/report/[id]", params: { id: match.id } })}
        onFresh={async () => {
          if (!client) return;
          setBusy(true);
          try {
            const job = await client.rerun(id);
            router.replace({ pathname: "/report/[id]", params: { id: job.id } });
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      />
      {error ? <Text style={{ color: c.tone.bad, paddingHorizontal: 16 }}>{error}</Text> : null}
    </>
  );
}

function Done({ record, onChanged }: { record: AnalysisRecord; onChanged(): void }) {
  const { view, setView, reduceMotion, client } = useSettings();
  const [mode, setMode] = useState<ReportView>(view);
  const cards = useMemo(() => reportCards(record, { client, reduceMotion, onDisputed: onChanged }), [record, client, reduceMotion, onChanged]);
  const graph = useMemo(() => buildGraph(record), [record]);
  const title = label(OVERALL, record.report.verdict.rating)[0];
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title }} />
      <View style={styles.toolbar}>
        <Segmented<ReportView>
          label="Show the report as"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setView(v);
          }}
          options={[
            { value: "cards", label: "Cards" },
            { value: "map", label: "3D map" },
          ]}
        />
      </View>
      {mode === "cards" ? (
        <CardDeck cards={cards} reduceMotion={reduceMotion} />
      ) : (
        <EvidenceMap graph={graph} reduceMotion={reduceMotion} onOpenUrl={openLink} onOpenReport={(rid) => router.push({ pathname: "/report/[id]", params: { id: rid } })} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  center: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "800" },
  toolbar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
});
