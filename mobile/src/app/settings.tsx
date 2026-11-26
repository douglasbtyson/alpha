import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Body, Button, Card, SectionLabel, Segmented } from "../components/ui";
import { makeClient } from "../lib/api";
import { normalizeServer } from "../lib/server";
import { useSettings, type ReportView } from "../lib/settings";
import { useColors } from "../lib/theme";

export default function SettingsScreen() {
  const c = useColors();
  const { server, token, setServer, setToken, view, setView, reduceMotion } = useSettings();
  const [address, setAddress] = useState(server ?? "");
  // Never pre-filled: a saved token stays in the Keychain and is only replaced when you type a new one.
  const [tokenInput, setTokenInput] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => setAddress(server ?? ""), [server]);

  const save = async () => {
    setStatus(null);
    const origin = normalizeServer(address);
    if (!origin) {
      setStatus({ ok: false, text: "That doesn't look like a web address. It usually looks like https://your-computer.your-tailnet.ts.net" });
      return;
    }
    setTesting(true);
    // The token this server will be used with: the one just typed, else the one already saved for it.
    const effective = tokenInput.trim() || (origin === server ? token : null);
    try {
      await setServer(origin, tokenInput);
      setTokenInput("");
      const h = await makeClient(origin, null).health();
      if (h.app !== "troonooz") throw new Error("That address answered, but it isn't a troonooz server.");
      if (h.auth_required) {
        if (!effective) throw new Error("Connected, but this server needs its API token. Type it above and tap Save and test again.");
        await makeClient(origin, effective).reports(1);
      }
      const models = h.demo ? "demo mode (sample results)" : `${h.model}${h.quick_model ? `, quick checks on ${h.quick_model}` : ""}`;
      setStatus({
        ok: h.claude_configured,
        text: h.claude_configured ? `Connected. troonooz is running with ${models}.` : "Connected, but the server has no Claude API key yet. Add one on the computer and restart troonooz.",
      });
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={[styles.title, { color: c.text }]}>Your troonooz server</Text>
          <Body muted>
            The address of troonooz on your computer, shared with your iPhone through Tailscale. Find it on the troonooz Phone page. The app fills this in by itself the first time your shortcut opens it.
          </Body>
          <SectionLabel>Address</SectionLabel>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="https://your-computer.your-tailnet.ts.net"
            placeholderTextColor={c.text3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            accessibilityLabel="Server address"
            style={[styles.input, { color: c.text, borderColor: c.borderStrong, backgroundColor: c.surface2 }]}
          />
          <SectionLabel>API token (only if you set one)</SectionLabel>
          <TextInput
            value={tokenInput}
            onChangeText={setTokenInput}
            placeholder={token ? "Saved (type a new one to replace it)" : "Leave empty if troonooz has no token"}
            placeholderTextColor={c.text3}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            accessibilityLabel="API token"
            style={[styles.input, { color: c.text, borderColor: c.borderStrong, backgroundColor: c.surface2 }]}
          />
          <Body muted style={styles.small}>
            Stored in this iPhone's Keychain and only ever sent to this server.
          </Body>
          {token ? <Button title="Remove saved token" kind="plain" onPress={() => void setToken("")} /> : null}
          <Button title="Save and test" onPress={save} busy={testing} style={styles.gap} />
          {status ? (
            <Text style={[styles.status, { color: status.ok ? c.tone.good : c.tone.bad }]} accessibilityRole="alert">
              {status.text}
            </Text>
          ) : null}
        </Card>

        <Card style={styles.gap}>
          <Text style={[styles.title, { color: c.text }]}>Open checks as</Text>
          <Segmented<ReportView>
            label="Open checks as"
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: "Card deck" },
              { value: "map", label: "3D map" },
            ]}
          />
          <Body muted style={styles.small}>
            You can switch at the top of every check.{reduceMotion ? " Reduce Motion is on, so cards and the map won't animate." : ""}
          </Body>
        </Card>

        <Card style={styles.gap}>
          <Text style={[styles.title, { color: c.text }]}>Open troonooz from the shortcut</Text>
          <Body muted>
            In the Shortcuts app, open your “Check with troonooz” shortcut. In the Get Dictionary Value action, change the key from open_url to app_url. The last action (Open URLs) then opens this app instead of Safari.
          </Body>
        </Card>

        <View style={styles.footer}>
          <Text style={{ color: c.text3, fontSize: 13 }}>troonooz {Constants.expoConfig?.version ?? ""}. AI can be wrong: check the cited sources.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 46, fontSize: 16 },
  small: { fontSize: 14, marginTop: 6 },
  gap: { marginTop: 14 },
  status: { fontSize: 15, marginTop: 10 },
  footer: { marginTop: 18, alignItems: "center" },
});
