import exifr from "exifr";

/**
 * Deterministic, non-AI signals pulled from the original file bytes before
 * anything is re-encoded. These are handed to Claude as context and shown in
 * the report. They are hints, not verdicts: metadata is easy to strip or forge,
 * and most social platforms strip it on upload.
 */
export interface MediaSignals {
  format: string;
  width: number | null;
  height: number | null;
  camera: string | null;
  software: string | null;
  captured: string | null;
  modified: string | null;
  hasGps: boolean;
  /** Embedded provenance / generator declarations (strongest signals). */
  provenance: string[];
  /** Weaker observations, e.g. editing software or absence of camera data. */
  notes: string[];
}

/** IPTC DigitalSourceType values that declare synthetic media. */
const IPTC_AI_SOURCE_TYPES: Record<string, string> = {
  trainedAlgorithmicMedia: "IPTC DigitalSourceType declares the media was created by generative AI (trainedAlgorithmicMedia)",
  compositeWithTrainedAlgorithmicMedia:
    "IPTC DigitalSourceType declares the media was edited/composited with generative AI (compositeWithTrainedAlgorithmicMedia)",
  algorithmicMedia: "IPTC DigitalSourceType declares the media is algorithmically generated (algorithmicMedia)",
  compositeSynthetic: "IPTC DigitalSourceType declares a composite including synthetic elements (compositeSynthetic)",
};

/**
 * Generator names that appear in metadata (Software, CreatorTool, C2PA claim
 * generators). All are long enough (>= 6 bytes) that a chance match inside
 * compressed pixel data is negligible.
 */
const AI_GENERATOR_MARKERS = [
  "Adobe Firefly",
  "DALL-E",
  "DALL·E",
  "Midjourney",
  "Stable Diffusion",
  "StableDiffusion",
  "ComfyUI",
  "NovelAI",
  "InvokeAI",
  "Ideogram",
  "Leonardo.Ai",
  "Bing Image Creator",
  "Microsoft Designer",
  "Google Imagen",
  "Meta AI",
  "Made with AI",
  "OpenAI",
  "OpenAI Sora",
  "RunwayML",
  "Kling AI",
  "Google Veo",
  "GPT-4o",
];

/** Common editing apps. Editing is normal and not deceptive by itself. */
const EDITING_MARKERS = [
  "Adobe Photoshop",
  "Photoshop",
  "Lightroom",
  "GIMP",
  "Snapseed",
  "Picsart",
  "Facetune",
  "Meitu",
  "Canva",
  "Affinity Photo",
  "Pixelmator",
  "CapCut",
  "Adobe Premiere",
  "After Effects",
  "DaVinci Resolve",
];

/** PNG text-chunk keywords written by popular image generators. */
const PNG_GENERATOR_KEYS: Record<string, string> = {
  parameters: "PNG text chunk \"parameters\" contains Stable Diffusion-style generation settings",
  prompt: "PNG text chunk \"prompt\" contains an image-generation prompt (ComfyUI-style)",
  workflow: "PNG text chunk \"workflow\" contains a ComfyUI generation workflow",
  "sd-metadata": "PNG text chunk \"sd-metadata\" contains InvokeAI generation settings",
  invokeai_metadata: "PNG text chunk \"invokeai_metadata\" contains InvokeAI generation settings",
  Dream: "PNG text chunk \"Dream\" contains generation settings",
};

function containsAscii(buf: Buffer, needle: string): boolean {
  return buf.indexOf(Buffer.from(needle, "utf8")) !== -1;
}

/** Walk PNG chunks and return tEXt/iTXt/zTXt keywords. */
export function pngTextKeywords(buf: Buffer): string[] {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) return [];
  const keys: string[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > buf.length) break;
    if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
      const nul = buf.indexOf(0, dataStart);
      if (nul > dataStart && nul < dataEnd) keys.push(buf.toString("latin1", dataStart, nul));
    }
    if (type === "IEND") break;
    off = dataEnd + 4; // skip CRC
  }
  return keys;
}

/**
 * The bytes where metadata lives, so marker scans don't run over compressed
 * pixel data: JPEG APPn/COM segments, PNG non-IDAT chunks. Other containers
 * (WebP, GIF, video) fall back to the head and tail of the file.
 */
export function metadataRegion(buf: Buffer): Buffer {
  // JPEG: SOI then segments until SOS.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    const parts: Buffer[] = [];
    let off = 2;
    while (off + 4 <= buf.length && buf[off] === 0xff) {
      const marker = buf[off + 1]!;
      if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
      if (marker === 0xff) {
        off += 1; // fill byte
        continue;
      }
      const len = buf.readUInt16BE(off + 2);
      if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
        parts.push(buf.subarray(off + 4, Math.min(buf.length, off + 2 + len)));
      }
      off += 2 + len;
    }
    return Buffer.concat(parts);
  }
  // PNG: every chunk except image data.
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(sig)) {
    const parts: Buffer[] = [];
    let off = 8;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString("latin1", off + 4, off + 8);
      const end = Math.min(buf.length, off + 8 + len);
      if (type !== "IDAT") parts.push(buf.subarray(off + 4, end));
      if (type === "IEND") break;
      off = off + 12 + len;
    }
    return Buffer.concat(parts);
  }
  const SPAN = 8 * 1024 * 1024;
  if (buf.length <= 2 * SPAN) return buf;
  return Buffer.concat([buf.subarray(0, SPAN), buf.subarray(buf.length - SPAN)]);
}

/** Scan a file's metadata bytes for provenance declarations. Works for images and video containers. */
export function scanProvenance(file: Buffer): { provenance: string[]; editors: string[] } {
  const buf = metadataRegion(file);
  const provenance: string[] = [];
  // C2PA manifests live in JUMBF boxes labelled "c2pa".
  if (containsAscii(buf, "jumb") && containsAscii(buf, "c2pa")) {
    provenance.push("C2PA Content Credentials manifest is embedded (provenance data from the creating app or camera)");
  }
  for (const [key, text] of Object.entries(IPTC_AI_SOURCE_TYPES)) {
    // Match the URI segment exactly to avoid "algorithmicMedia" matching inside the longer names.
    if (containsAscii(buf, `digitalsourcetype/${key}`) || containsAscii(buf, `"${key}"`) || containsAscii(buf, `>${key}<`)) {
      provenance.push(text);
    }
  }
  const generators = AI_GENERATOR_MARKERS.filter((m) => containsAscii(buf, m));
  for (const g of generators) {
    // "OpenAI" is a substring of "OpenAI Sora"; report only the most specific.
    if (generators.some((o) => o !== g && o.includes(g))) continue;
    provenance.push(`Metadata mentions the AI generator "${g}"`);
  }
  for (const key of pngTextKeywords(file)) {
    const text = PNG_GENERATOR_KEYS[key];
    if (text) provenance.push(text);
  }
  const editors = EDITING_MARKERS.filter((m) => containsAscii(buf, m));
  // "Photoshop" is a substring of "Adobe Photoshop"; keep the most specific.
  const dedupedEditors = editors.filter((e) => !editors.some((o) => o !== e && o.includes(e)));
  return { provenance: [...new Set(provenance)], editors: dedupedEditors };
}

function fmtDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function extractImageSignals(
  buf: Buffer,
  info: { format: string; width: number | null; height: number | null },
): Promise<MediaSignals> {
  let tags: Record<string, unknown> = {};
  try {
    tags = ((await exifr.parse(buf, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false })) ??
      {}) as Record<string, unknown>;
  } catch {
    // Unparseable or absent metadata is common and not an error.
  }

  const make = str(tags.Make);
  const model = str(tags.Model);
  const camera = [make, model].filter(Boolean).join(" ") || null;
  const software = str(tags.Software) ?? str(tags.CreatorTool);
  const { provenance, editors } = scanProvenance(buf);
  const digitalSourceType = str(tags.DigitalSourceType);
  if (digitalSourceType) {
    const key = digitalSourceType.split("/").pop() ?? "";
    const text = IPTC_AI_SOURCE_TYPES[key];
    if (text && !provenance.includes(text)) provenance.push(text);
  }

  const notes: string[] = [];
  if (editors.length > 0) notes.push(`Metadata mentions editing software: ${editors.join(", ")}`);
  if (!camera && provenance.length === 0) {
    notes.push("No camera or provenance metadata (normal for screenshots and images downloaded from social media)");
  }
  const hasGps = typeof tags.latitude === "number" && typeof tags.longitude === "number";
  if (hasGps) notes.push("GPS coordinates are embedded");

  return {
    format: info.format,
    width: info.width,
    height: info.height,
    camera,
    software,
    captured: fmtDate(tags.DateTimeOriginal) ?? fmtDate(tags.CreateDate),
    modified: fmtDate(tags.ModifyDate),
    hasGps,
    provenance,
    notes,
  };
}

/** Human-readable one-block summary for the prompt. */
export function describeSignals(s: MediaSignals): string {
  const lines: string[] = [];
  lines.push(`format ${s.format}${s.width && s.height ? `, original ${s.width}x${s.height}` : ""}`);
  if (s.camera) lines.push(`camera: ${s.camera}`);
  if (s.software) lines.push(`software: ${s.software}`);
  if (s.captured) lines.push(`captured: ${s.captured}`);
  if (s.modified) lines.push(`modified: ${s.modified}`);
  for (const p of s.provenance) lines.push(`PROVENANCE: ${p}`);
  for (const n of s.notes) lines.push(n);
  return lines.join("; ");
}
