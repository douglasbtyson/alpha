import { useColorScheme } from "react-native";
import type { Tone } from "./labels";

/** The same palette as the web app (public/styles.css), light and dark. */
const light = {
  bg: "#f6f7f9",
  surface: "#ffffff",
  surface2: "#f1f3f6",
  border: "#e2e6ec",
  borderStrong: "#cdd3dc",
  text: "#121826",
  text2: "#4a5568",
  text3: "#6b7686",
  accent: "#0f766e",
  accentSoft: "#e3f4f1",
  onAccent: "#ffffff",
  space: "#0b1220",
  spaceText: "#e8ecf2",
  tone: { good: "#15803d", ok: "#4d7c0f", caution: "#b45309", warn: "#c2410c", bad: "#b91c1c", neutral: "#64748b" } as Record<Tone, string>,
  toneSoft: { good: "#e6f4ea", ok: "#eef6e1", caution: "#fdf3e2", warn: "#fdece3", bad: "#fde8e8", neutral: "#eef1f5" } as Record<Tone, string>,
};

const dark: typeof light = {
  bg: "#0d1117",
  surface: "#151b23",
  surface2: "#1c232d",
  border: "#262f3b",
  borderStrong: "#354152",
  text: "#e8ecf2",
  text2: "#b3bdcb",
  text3: "#8a96a8",
  accent: "#2dd4bf",
  accentSoft: "#10312e",
  onAccent: "#04201d",
  space: "#070b12",
  spaceText: "#e8ecf2",
  tone: { good: "#4ade80", ok: "#a3d65c", caution: "#fbbf24", warn: "#fb923c", bad: "#f87171", neutral: "#94a3b8" },
  toneSoft: { good: "#0f2d1b", ok: "#1e2b10", caution: "#33260b", warn: "#36190b", bad: "#3a1414", neutral: "#1f2732" },
};

/** Bright tones that read on the evidence map's dark "space" background in either mode. */
export const MAP_TONE: Record<Tone, string> = dark.tone;

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
