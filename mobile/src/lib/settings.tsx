import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { makeClient, type CheckMode, type Client } from "./api";
import { normalizeServer, tokenKey } from "./server";

export type ReportView = "cards" | "map";

interface Settings {
  ready: boolean;
  server: string | null;
  token: string | null;
  client: Client | null;
  view: ReportView;
  mode: CheckMode;
  /** The system's Reduce Motion setting: no spinning, flipping, or swooping when it's on. */
  reduceMotion: boolean;
  /** Saves the address (and, when given, a token for it). Returns the cleaned-up address, or null if invalid. */
  setServer(input: string, token?: string): Promise<string | null>;
  /** Saves (or, when empty, removes) the token for the current server. */
  setToken(token: string): Promise<void>;
  setView(view: ReportView): void;
  setMode(mode: CheckMode): void;
}

const KEYS = { server: "troonooz.server", view: "troonooz.view", mode: "troonooz.mode" };

// Tokens live in the iOS Keychain. The web preview (used only for testing) has no keychain.
const secret = {
  get: (key: string) => (Platform.OS === "web" ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) => (Platform.OS === "web" ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value)),
  remove: (key: string) => (Platform.OS === "web" ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

const SettingsContext = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServerState] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [view, setViewState] = useState<ReportView>("cards");
  const [mode, setModeState] = useState<CheckMode>("quick");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, v, m] = await Promise.all([AsyncStorage.getItem(KEYS.server), AsyncStorage.getItem(KEYS.view), AsyncStorage.getItem(KEYS.mode)]);
        const origin = normalizeServer(s);
        const t = origin ? await secret.get(tokenKey(origin)).catch(() => null) : null;
        if (!alive) return;
        setServerState(origin);
        setTokenState(t || null);
        if (v === "cards" || v === "map") setViewState(v);
        if (m === "quick" || m === "thorough") setModeState(m);
      } finally {
        if (alive) setReady(true);
      }
    })();
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setReduceMotion(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const setServer = useCallback(async (input: string, newToken?: string) => {
    const origin = normalizeServer(input);
    if (!origin) return null;
    await AsyncStorage.setItem(KEYS.server, origin);
    if (newToken?.trim()) await secret.set(tokenKey(origin), newToken.trim());
    // Each server keeps its own token, so switching servers never sends one server's token to another.
    const t = await secret.get(tokenKey(origin)).catch(() => null);
    setServerState(origin);
    setTokenState(t || null);
    return origin;
  }, []);

  const setToken = useCallback(
    async (value: string) => {
      if (!server) return;
      const t = value.trim();
      if (t) await secret.set(tokenKey(server), t);
      else await secret.remove(tokenKey(server));
      setTokenState(t || null);
    },
    [server],
  );

  const setView = useCallback((v: ReportView) => {
    setViewState(v);
    AsyncStorage.setItem(KEYS.view, v).catch(() => {});
  }, []);

  const setMode = useCallback((m: CheckMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEYS.mode, m).catch(() => {});
  }, []);

  const client = useMemo(() => (server ? makeClient(server, token) : null), [server, token]);

  const value = useMemo<Settings>(
    () => ({ ready, server, token, client, view, mode, reduceMotion, setServer, setToken, setView, setMode }),
    [ready, server, token, client, view, mode, reduceMotion, setServer, setToken, setView, setMode],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(SettingsContext);
  if (!s) throw new Error("useSettings must be used inside <SettingsProvider>");
  return s;
}
