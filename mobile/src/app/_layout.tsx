import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SettingsProvider } from "../lib/settings";
import { useColors } from "../lib/theme";

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useColors();
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: c.accent, background: c.bg, card: c.surface, text: c.text, border: c.border } };
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerTintColor: c.accent, headerTitleStyle: { color: c.text }, contentStyle: { backgroundColor: c.bg } }}>
            <Stack.Screen name="index" options={{ title: "troonooz" }} />
            <Stack.Screen name="report/[id]" options={{ title: "Check" }} />
            <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
          </Stack>
        </ThemeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
