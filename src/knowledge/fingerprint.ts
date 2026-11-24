import { createHash } from "node:crypto";
import sharp from "sharp";
import { canonicalUrl } from "../analysis/grounding.js";

/**
 * Content fingerprints used to recognise a submission that was already checked.
 *
 * Images use two stages, because a perceptual hash alone can't tell two
 * different posts in the same app layout apart (the text is a sliver of the
 * image; the rest is identical white space):
 *   1. a 256-bit difference hash (dHash) shortlists candidates cheaply;
 *   2. a 320px-wide greyscale thumbnail confirms the match: after brightness
 *      normalisation, no 4x4 block may differ by much. A changed word or price
 *      fails this; resizing, recompression and format changes pass.
 * Neither stage survives cropping, so screenshots of the same post from two
 * phones won't match; the entity database covers that case.
 */

export type FingerprintKind = "image" | "video" | "url" | "text";

export interface Fingerprint {
  /** Evidence ID this fingerprint belongs to (img1, vid1, link1, text). */
  ref: string;
  kind: FingerprintKind;
  /** image: 64 hex chars; video: comma-separated frame hashes; url: canonical URL; text: sha256. */
  value: string;
  /** image only: base64 PNG of the greyscale verification thumbnail. */
  thumb?: string;
}

const HASH_W = 17;
const HASH_H = 16;
/** Shortlist: dHash bits (of 256) that may differ for a candidate worth verifying. */
export const SHORTLIST_BITS = 48;
/** Video frames: dHash bits that may differ for two frames to count as the same. */
export const FRAME_MATCH_BITS = 24;
/** Below this greyscale spread an image is too uniform to identify (blank, solid colour). */
const MIN_STDEV = 6;
const THUMB_WIDTH = 320;
const THUMB_MAX_HEIGHT = 4096;
const BLOCK = 4;
/** Max mean absolute difference (0-255) over any 4x4 block of the normalised thumbnails. */
export const VERIFY_MAX_DIFF = 32;
/** Aspect ratios must agree within this fraction. */
const ASPECT_TOLERANCE = 0.03;

function grey(buf: Buffer) {
  return sharp(buf, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).grayscale();
}

/** 256-bit dHash, or null when the image carries too little structure to identify. */
export async function imageHash(buf: Buffer): Promise<string | null> {
  const { data } = await grey(buf).resize(HASH_W, HASH_H, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let sq = 0;
  for (const v of data) sq += (v - mean) ** 2;
  if (Math.sqrt(sq / data.length) < MIN_STDEV) return null;

  let hex = "";
  let nibble = 0;
  let n = 0;
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      nibble = (nibble << 1) | (data[y * HASH_W + x]! > data[y * HASH_W + x + 1]! ? 1 : 0);
      if (++n % 4 === 0) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

/** Greyscale verification thumbnail as a PNG. */
export async function verifyThumb(buf: Buffer): Promise<Buffer> {
  return grey(buf)
    .resize({ width: THUMB_WIDTH, height: THUMB_MAX_HEIGHT, fit: "inside", kernel: "cubic" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Fingerprint an image, or null when it is too uniform to identify. */
export async function imagePrint(ref: string, buf: Buffer): Promise<Fingerprint | null> {
  const hash = await imageHash(buf);
  if (!hash) return null;
  return { ref, kind: "image", value: hash, thumb: (await verifyThumb(buf)).toString("base64") };
}

async function rawGrey(png: Buffer, size?: { width: number; height: number }) {
  let pipeline = sharp(png).grayscale();
  if (size) pipeline = pipeline.resize(size.width, size.height, { fit: "fill", kernel: "cubic" });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function stats(data: Buffer): { mean: number; sd: number } {
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let sq = 0;
  for (const v of data) sq += (v - mean) ** 2;
  return { mean, sd: Math.sqrt(sq / data.length) };
}

/** Largest local difference between two verification thumbnails, or Infinity if their shapes differ. */
export async function thumbDistance(aPng: Buffer, bPng: Buffer): Promise<number> {
  const a = await rawGrey(aPng);
  const bMeta = await sharp(bPng).metadata();
  const ra = a.width / a.height;
  const rb = (bMeta.width ?? 1) / (bMeta.height ?? 1);
  if (Math.abs(ra - rb) / ra > ASPECT_TOLERANCE) return Number.POSITIVE_INFINITY;
  const b = await rawGrey(bPng, { width: a.width, height: a.height });

  // Normalise b's brightness and contrast to a's.
  const sa = stats(a.data);
  const sb = stats(b.data);
  const gain = sb.sd > 1 ? sa.sd / sb.sd : 1;
  const nb = (v: number) => (v - sb.mean) * gain + sa.mean;

  // Integral image of absolute differences, then the worst BLOCKxBLOCK window.
  const w = a.width;
  const h = a.height;
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      row += Math.abs(a.data[i]! - nb(b.data[i]!));
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1]! + row;
    }
  }
  const k = Math.min(BLOCK, w, h);
  let max = 0;
  for (let y = 0; y + k <= h; y++) {
    for (let x = 0; x + k <= w; x++) {
      const s = sum[(y + k) * (w + 1) + x + k]! - sum[y * (w + 1) + x + k]! - sum[(y + k) * (w + 1) + x]! + sum[y * (w + 1) + x]!;
      if (s > max) max = s;
    }
  }
  return max / (k * k);
}

export async function sameImage(a: Fingerprint, b: Fingerprint): Promise<boolean> {
  if (a.kind !== "image" || b.kind !== "image" || !a.thumb || !b.thumb) return false;
  if (hamming(a.value, b.value) > SHORTLIST_BITS) return false;
  return (await thumbDistance(Buffer.from(a.thumb, "base64"), Buffer.from(b.thumb, "base64"))) <= VERIFY_MAX_DIFF;
}

const POPCOUNT = Array.from({ length: 16 }, (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));

/** Number of differing bits between two equal-length hex hashes (Infinity if incomparable). */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    if (Number.isNaN(x)) return Number.POSITIVE_INFINITY;
    d += POPCOUNT[x]!;
  }
  return d;
}

/** Fraction of video frames in `a` that have a matching frame in `b`. */
export function videoOverlap(a: string, b: string): number {
  const fa = a.split(",").filter(Boolean);
  const fb = b.split(",").filter(Boolean);
  if (fa.length === 0 || fb.length === 0) return 0;
  const hits = fa.filter((x) => fb.some((y) => hamming(x, y) <= FRAME_MATCH_BITS)).length;
  return hits / fa.length;
}

/** Share of frames that must match for two videos to count as the same. */
export const VIDEO_MATCH_SHARE = 0.75;

/** Lowercase, canonicalise URLs, strip punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, (u) => canonicalUrl(u) ?? u)
    .replace(/[^\p{L}\p{N}./$%-]+/gu, " ")
    // Keep . / - only inside words and URLs ("i-95", "example.org/story"), not as sentence punctuation.
    .replace(/[./-](?![\p{L}\p{N}])/gu, " ")
    .replace(/(^|\s)[./-]+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimum normalized length for text to count as identifiable content rather than a short note. */
export const MIN_TEXT_CHARS = 40;

export function textHash(text: string): string | null {
  const n = normalizeText(text);
  if (n.length < MIN_TEXT_CHARS) return null;
  return createHash("sha256").update(n).digest("hex");
}
