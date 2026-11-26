import * as z from "zod/v4";
import { FOCUS_AREAS, type FocusArea } from "./schema.js";

/** A file received from the client. */
export interface UploadedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** A video frame extracted client-side (web app or extension multi-frame capture). */
export interface FrameUpload extends UploadedFile {
  video: string;
  time: number;
  duration: number | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim().slice(0, max));

/**
 * What the browser extension extracts from a page. Everything is optional and
 * lenient: pages are messy, and a missing field must never fail an analysis.
 * `text` and `selection` are left long here so truncation can be reported.
 */
export const PageCaptureSchema = z.object({
  url: optionalText(2048),
  title: optionalText(500),
  site_name: optionalText(200),
  description: optionalText(2000),
  author: optionalText(300),
  published: optionalText(100),
  canonical: optionalText(2048),
  lang: optionalText(20),
  selection: optionalText(200_000),
  text: optionalText(1_000_000),
  capture_mode: z
    .enum(["page", "area", "video", "image", "selection", "link"])
    .optional()
    .catch(undefined),
  link_url: optionalText(2048),
  image_url: optionalText(2048),
});
export type PageCapture = z.infer<typeof PageCaptureSchema>;

export type InputSource = "web" | "extension" | "shortcut" | "app" | "api";

export type { CheckMode } from "./prompts.js";
import type { CheckMode } from "./prompts.js";

export interface AnalysisInput {
  files: UploadedFile[];
  frames: FrameUpload[];
  imageUrls: string[];
  text: string;
  urls: string[];
  page: PageCapture | null;
  focus: FocusArea[];
  webResearch: boolean;
  source: InputSource;
  /** "quick" trades thoroughness for speed; defaults to "thorough". */
  mode?: CheckMode;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Parse a list field that may arrive as a JSON array, a newline/comma list, or repeated fields. */
export function parseList(value: unknown): string[] {
  const items: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t) return;
    if (t.startsWith("[")) {
      try {
        const arr = JSON.parse(t) as unknown;
        if (Array.isArray(arr)) {
          for (const a of arr) push(a);
          return;
        }
      } catch {
        // fall through to plain splitting
      }
    }
    for (const part of t.split(/[\n,]+/)) {
      const p = part.trim();
      if (p) items.push(p);
    }
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return items;
}

export function parseFocus(value: unknown): FocusArea[] {
  const raw = parseList(value).map((s) => s.toLowerCase());
  return FOCUS_AREAS.filter((f) => raw.includes(f));
}

export function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}
