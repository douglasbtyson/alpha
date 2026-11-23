import sharp, { type Sharp } from "sharp";

/** Claude's high-resolution vision limit: 2576px on the long edge, ~3.75 megapixels. */
export const MAX_EDGE = 2576;
export const MAX_PIXELS = 3_750_000;
/** Base64 image blocks must stay under 5MB, i.e. ~3.75MB of raw bytes. Keep a margin. */
export const MAX_IMAGE_BYTES = 3_600_000;
/** Very tall or wide captures (scrolling screenshots) are split instead of shrunk into illegibility. */
const TILE_ASPECT = 2.6;
const TILE_SHORT_EDGE = 1568;
const TILE_OVERLAP = 120;
const MAX_TILES = 6;

export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One image block as sent to Claude, plus what is needed to zoom back into the original. */
export interface PreparedImage {
  mediaType: "image/jpeg" | "image/png";
  data: Buffer;
  width: number;
  height: number;
  /** Where this block sits in the (EXIF-oriented) original, in original pixels. */
  region: Region;
}

export interface ImageInfo {
  format: string;
  width: number;
  height: number;
}

export async function probeImage(buf: Buffer): Promise<ImageInfo> {
  const m = await sharp(buf, { failOn: "none" }).metadata();
  if (!m.width || !m.height) throw new Error("Image has no dimensions");
  const swap = (m.orientation ?? 1) >= 5;
  return {
    format: m.format ?? "unknown",
    width: swap ? m.height : m.width,
    height: swap ? m.width : m.height,
  };
}

async function encode(pipeline: Sharp, preferPng: boolean): Promise<{ data: Buffer; mediaType: PreparedImage["mediaType"] }> {
  if (preferPng) {
    const png = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer();
    if (png.length <= MAX_IMAGE_BYTES) return { data: png, mediaType: "image/png" };
  }
  for (const quality of [90, 82, 72, 60]) {
    const jpg = await pipeline.clone().flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpg.length <= MAX_IMAGE_BYTES) return { data: jpg, mediaType: "image/jpeg" };
  }
  throw new Error("Image could not be compressed under the size limit");
}

/** Screenshots and graphics (PNG/GIF/WebP sources) keep crisp text as PNG when it fits. */
function prefersPng(format: string): boolean {
  return format === "png" || format === "gif" || format === "webp";
}

/**
 * Prepare an image for Claude: apply EXIF orientation, fit within the vision
 * limits, and tile very tall/wide captures along their long axis.
 */
export async function prepareImage(buf: Buffer, opts: { maxEdge?: number } = {}): Promise<{ info: ImageInfo; blocks: PreparedImage[] }> {
  const info = await probeImage(buf);
  const maxEdge = Math.min(opts.maxEdge ?? MAX_EDGE, MAX_EDGE);
  const { width: w, height: h } = info;
  const png = prefersPng(info.format);
  const vertical = h >= w;
  const long = Math.max(w, h);
  const short = Math.min(w, h);

  if (long / short > TILE_ASPECT && long > maxEdge) {
    let scale = Math.min(1, TILE_SHORT_EDGE / short);
    let tileLen = 0;
    let count = 0;
    for (;;) {
      const sShort = short * scale;
      tileLen = Math.min(maxEdge, Math.floor(MAX_PIXELS / sShort));
      const sLong = long * scale;
      count = sLong <= tileLen ? 1 : Math.ceil((sLong - TILE_OVERLAP) / (tileLen - TILE_OVERLAP));
      if (count <= MAX_TILES) break;
      scale *= 0.85;
    }
    const sLong = Math.round(long * scale);
    const stride = count > 1 ? (sLong - tileLen) / (count - 1) : 0;
    const blocks: PreparedImage[] = [];
    for (let i = 0; i < count; i++) {
      const sStart = Math.round(i * stride);
      const oStart = Math.min(long - 1, Math.round(sStart / scale));
      const oLen = Math.min(long - oStart, Math.round(Math.min(tileLen, sLong) / scale));
      const region: Region = vertical
        ? { left: 0, top: oStart, width: w, height: oLen }
        : { left: oStart, top: 0, width: oLen, height: h };
      // Floor, not round: rounding up can push a tile just past the pixel limit.
      const outW = Math.max(1, Math.floor(region.width * scale));
      const outH = Math.max(1, Math.floor(region.height * scale));
      const pipeline = sharp(buf, { failOn: "none" }).rotate().extract(region).resize(outW, outH);
      const { data, mediaType } = await encode(pipeline, png);
      blocks.push({ data, mediaType, width: outW, height: outH, region });
    }
    return { info, blocks };
  }

  const scale = Math.min(1, maxEdge / long, Math.sqrt(MAX_PIXELS / (w * h)));
  const outW = scale === 1 ? w : Math.max(1, Math.floor(w * scale));
  const outH = scale === 1 ? h : Math.max(1, Math.floor(h * scale));
  const pipeline = sharp(buf, { failOn: "none" }).rotate().resize(outW, outH);
  const { data, mediaType } = await encode(pipeline, png);
  return { info, blocks: [{ data, mediaType, width: outW, height: outH, region: { left: 0, top: 0, width: w, height: h } }] };
}

/** Small JPEG preview for the report page and history list. */
export async function thumbnail(buf: Buffer): Promise<string> {
  const jpg = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 360, height: 720, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 72 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

export interface ZoomRequest {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop a region of a sent image (coordinates in the sent image's pixels) from
 * the full-resolution original, magnified so small details are legible.
 */
export async function zoomCrop(
  original: Buffer,
  sent: { width: number; height: number; region: Region },
  req: ZoomRequest,
): Promise<{ data: Buffer; mediaType: PreparedImage["mediaType"]; width: number; height: number; crop: Region }> {
  const x = Math.max(0, Math.min(sent.width - 1, Math.round(req.x)));
  const y = Math.max(0, Math.min(sent.height - 1, Math.round(req.y)));
  const wReq = Math.max(8, Math.round(req.width));
  const hReq = Math.max(8, Math.round(req.height));
  const sx = sent.region.width / sent.width;
  const sy = sent.region.height / sent.height;
  const left = sent.region.left + Math.floor(x * sx);
  const top = sent.region.top + Math.floor(y * sy);
  const right = Math.min(sent.region.left + sent.region.width, sent.region.left + Math.ceil((x + wReq) * sx));
  const bottom = Math.min(sent.region.top + sent.region.height, sent.region.top + Math.ceil((y + hReq) * sy));
  const crop: Region = { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

  // Magnify small crops (up to 4x) so fine detail is visible; cap large ones.
  const long = Math.max(crop.width, crop.height);
  const target = Math.min(1568, Math.max(long, Math.min(long * 4, 1024)));
  const scale = target / long;
  const outW = Math.max(1, Math.round(crop.width * scale));
  const outH = Math.max(1, Math.round(crop.height * scale));
  const pipeline = sharp(original, { failOn: "none" })
    .rotate()
    .extract(crop)
    .resize(outW, outH, { kernel: scale > 1 ? "nearest" : "lanczos3" });
  const { data, mediaType } = await encode(pipeline, true);
  return { data, mediaType, width: outW, height: outH, crop };
}
